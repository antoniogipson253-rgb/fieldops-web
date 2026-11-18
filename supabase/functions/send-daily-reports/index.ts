import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { archiveSend, type ArchiveStatus } from './archive.ts';

// send-daily-reports
//
// Two modes, chosen by the bearer token:
//   - Cron mode: bearer === SUPABASE_SERVICE_ROLE_KEY (pg_cron, every 15 min). For every
//     enabled project whose local send time has passed within the last 2 hours and whose
//     report for that send time has not gone out yet, build and send the report.
//   - Test mode: any other bearer must be a valid user JWT; body { projectId }. Caller must
//     be a company admin/PM for that project. Sends the report-so-far to the caller's own
//     email only and does NOT change any settings or the report window.
//
// Report window (rule: a report contains ONLY what happened on that project-local
// calendar day, nothing older, ever):
//   activity_log.occurred_at in [local midnight of the report day, min(buildTime, next local midnight))
// computed with the DST-safe zonedLocalToUtc helper. A change belongs to the day of its
// occurred_at: one that happened on an earlier day never appears, even if it synced today.
// There is no carry-over: a day that is not sent (failure, missed window, no recipients)
// is never added to a later report. last_report_cutoff no longer defines the window; it is
// only used to skip a send time that passed before the setting was switched on.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SEND_WINDOW_MS = 2 * 60 * 60 * 1000;   // send no later than send_time + 2h
const MAX_ACTIVITY_ROWS = 20000;
const PAGE_SIZE = 1000;
const COLLAPSE_THRESHOLD = 5;                // >= 5 creations/photos per person collapse to one line
const MAX_LINES_PER_PERSON = 30;
const MAX_LINES_TOTAL = 200;
const MAX_CREW_ENTRIES = 50;
const FROM = 'FieldOps Pro <noreply@mail.fieldopspro.org>';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

type ActivityRow = {
  id: string;
  actor_id: string | null;
  entity_type: string;
  action_type: string;
  old_value: string | null;
  new_value: string | null;
  description: string;
  occurred_at: string;
  created_at: string;
};

type Recipient = { email: string };

// ---------------------------------------------------------------------------
// Time zone helpers (Intl-based, DST-correct)
// ---------------------------------------------------------------------------

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

// Offset of `timeZone` from UTC at instant `date`, in ms (e.g. CDT = -5h).
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Local wall-clock time in `timeZone` -> UTC instant.
//  - Ambiguous times (fall back) resolve to the first occurrence.
//  - Nonexistent times (spring forward gap) resolve forward past the gap (02:30 -> 03:30).
function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(new Date(guess), timeZone);
  const utc1 = guess - off1;
  const off2 = tzOffsetMs(new Date(utc1), timeZone);
  if (off2 === off1) return new Date(utc1);
  const utc2 = guess - off2;
  if (tzOffsetMs(new Date(utc2), timeZone) === off2) return new Date(utc2);
  return new Date(Math.max(utc1, utc2)); // inside a DST gap
}

function addDays(y: number, m: number, d: number, delta: number) {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const [h, m] = sendTime.split(':').map(Number);
  return { hour: h, minute: m };
}

type DueState =
  | { state: 'due'; scheduledAt: Date; scheduledDate: string }
  | { state: 'already_sent' | 'outside_window' | 'not_due' };

const dateKey = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

// Decide whether a project's report is due right now.
// Candidates are the scheduled instants for local today and local yesterday (yesterday
// matters when send_time + 2h crosses midnight, e.g. 23:30).
// A scheduled send counts as handled if last_sent_date is its local date, or if the
// setting was switched on after it (enabledAt >= scheduled instant).
export function evaluateDue(now: Date, sendTime: string, timeZone: string, enabledAt: Date, lastSentDate: string | null): DueState {
  const { hour, minute } = parseSendTime(sendTime);
  const today = zonedParts(now, timeZone);
  const yesterday = addDays(today.year, today.month, today.day, -1);

  const candidates = [today, yesterday].map((d) => ({
    date: dateKey(d),
    at: zonedLocalToUtc(d.year, d.month, d.day, hour, minute, timeZone),
  }));
  const handled = (c: { date: string; at: Date }) => lastSentDate === c.date || enabledAt.getTime() >= c.at.getTime();

  for (const c of candidates) {
    const inWindow = now.getTime() >= c.at.getTime() && now.getTime() < c.at.getTime() + SEND_WINDOW_MS;
    if (inWindow) {
      return handled(c) ? { state: 'already_sent' } : { state: 'due', scheduledAt: c.at, scheduledDate: c.date };
    }
  }

  const sToday = candidates[0];
  if (now.getTime() < sToday.at.getTime()) return { state: 'not_due' };
  // Past today's window. A missed day is simply not sent; it never rolls into a later report.
  return handled(sToday) ? { state: 'already_sent' } : { state: 'outside_window' };
}

// The project-local calendar day `localDate` ('YYYY-MM-DD') as a UTC window:
// [local midnight, min(buildTime, next local midnight)). DST-safe via zonedLocalToUtc, so
// the fall-back day is 25 hours long and the spring-forward day 23 hours. When a report is
// built after midnight for the previous day (send time near midnight), the window still
// stops at that day's midnight.
export function dayWindow(localDate: string, timeZone: string, buildTime: Date): { start: Date; end: Date; dayEnd: Date } {
  const [y, m, d] = localDate.split('-').map(Number);
  const start = zonedLocalToUtc(y, m, d, 0, 0, timeZone);
  const next = addDays(y, m, d, 1);
  const dayEnd = zonedLocalToUtc(next.year, next.month, next.day, 0, 0, timeZone);
  return { start, end: new Date(Math.min(buildTime.getTime(), dayEnd.getTime())), dayEnd };
}

export function localDateOf(date: Date, timeZone: string): string {
  return dateKey(zonedParts(date, timeZone));
}

// Belt and braces on top of the database filter: drop anything whose occurred_at is
// outside [start, end), whatever the query returned.
export function filterToWindow<T extends { occurred_at: string }>(rows: T[], start: Date, end: Date): T[] {
  return rows.filter((r) => {
    const t = new Date(r.occurred_at).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
}

function formatLocalTime(date: Date, timeZone: string, includeDate: boolean): string {
  const opts: Intl.DateTimeFormatOptions = includeDate
    ? { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { timeZone, hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

function formatLocalDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function localDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function tzAbbrev(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

// Activity that HAPPENED (occurred_at) in [from, to). When it was recorded (created_at) is
// irrelevant: a change from an earlier day that synced today is excluded.
async function loadActivity(admin: SupabaseClient, projectId: string, from: Date, to: Date): Promise<{ rows: ActivityRow[]; truncated: boolean }> {
  const rows: ActivityRow[] = [];
  for (let offset = 0; offset < MAX_ACTIVITY_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('activity_log')
      .select('id, actor_id, entity_type, action_type, old_value, new_value, description, occurred_at, created_at')
      .eq('project_id', projectId)
      .gte('occurred_at', from.toISOString())
      .lt('occurred_at', to.toISOString())
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...filterToWindow((data ?? []) as ActivityRow[], from, to));
    if (!data || data.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function loadNames(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await admin.from('profiles').select('id, full_name').in('id', ids);
  if (error) throw error;
  return new Map((data ?? []).map((p: any) => [p.id, p.full_name || 'Unknown user']));
}

type CrewEntry = { name: string; clockIn: Date; clockOut: Date | null };
type Crew = { entries: CrewEntry[]; total: number };

// Names and clock-in/out times only. No pay, wage, or location columns are selected.
// Only clock-ins that happened within the report day's window [from, to); an entry that
// started on an earlier day is never shown. Capped at MAX_CREW_ENTRIES.
async function loadCrew(admin: SupabaseClient, projectId: string, from: Date, to: Date): Promise<Crew> {
  const { data, error, count } = await admin
    .from('time_entries')
    .select('user_id, clock_in, clock_out', { count: 'exact' })
    .eq('project_id', projectId)
    .gte('clock_in', from.toISOString())
    .lt('clock_in', to.toISOString())
    .order('clock_in', { ascending: true })
    .limit(MAX_CREW_ENTRIES);
  if (error) throw error;
  const names = await loadNames(admin, (data ?? []).map((e: any) => e.user_id).filter(Boolean));
  const entries = (data ?? []).map((e: any) => ({
    name: names.get(e.user_id) ?? 'Unknown user',
    clockIn: new Date(e.clock_in),
    clockOut: e.clock_out ? new Date(e.clock_out) : null,
  }));
  return { entries, total: count ?? entries.length };
}

// User recipients resolve to the profile's current email at send time. Deduped by
// lower-cased final address.
async function resolveRecipients(admin: SupabaseClient, projectId: string): Promise<{ recipients: Recipient[]; skippedNoEmail: number }> {
  const { data: rows, error } = await admin
    .from('project_report_recipients')
    .select('user_id, email')
    .eq('project_id', projectId);
  if (error) throw error;

  const userIds = (rows ?? []).map((r: any) => r.user_id).filter(Boolean);
  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', userIds.length > 0 ? userIds : [NIL_UUID]);
  if (profilesError) throw profilesError;
  const emailByUser = new Map((profiles ?? []).map((p: any) => [p.id, p.email as string | null]));

  const byEmail = new Map<string, Recipient>();
  let skippedNoEmail = 0;
  for (const r of rows ?? []) {
    let email: string | null = null;
    if (r.user_id) {
      email = emailByUser.get(r.user_id)?.trim() || null;
      if (!email) {
        skippedNoEmail++;
        console.log(`Project ${projectId}: skipping recipient user ${r.user_id}, no email on file`);
        continue;
      }
    } else {
      email = r.email?.trim() || null;
    }
    if (email && !byEmail.has(email.toLowerCase())) byEmail.set(email.toLowerCase(), { email });
  }
  return { recipients: [...byEmail.values()], skippedNoEmail };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

type Counts = {
  tasksCompleted: number; taskStatusChanges: number; tasksCreated: number;
  checklistDone: number; partsMissing: number; partsReceived: number;
  punchCreated: number; punchClosed: number; photos: number; comments: number;
};

function countActivity(rows: ActivityRow[]): Counts {
  const c: Counts = {
    tasksCompleted: 0, taskStatusChanges: 0, tasksCreated: 0,
    checklistDone: 0, partsMissing: 0, partsReceived: 0,
    punchCreated: 0, punchClosed: 0, photos: 0, comments: 0,
  };
  for (const r of rows) {
    switch (r.action_type) {
      case 'task_status_changed':
        c.taskStatusChanges++;
        if (r.new_value === 'completed') c.tasksCompleted++;
        break;
      case 'task_created': c.tasksCreated++; break;
      case 'punch_item_created': c.punchCreated++; break;
      case 'punch_item_status_changed':
        if (r.new_value === 'completed') c.punchClosed++;
        break;
      case 'checklist_item_status_changed':
        if (r.new_value === 'done') c.checklistDone++;
        if (r.new_value === 'missing_part') c.partsMissing++;
        if (r.new_value === 'part_received') c.partsReceived++;
        break;
      case 'photo_uploaded': c.photos++; break;
      case 'comment_added': c.comments++; break;
    }
  }
  return c;
}

function rollupSentence(c: Counts): string {
  const parts: string[] = [];
  if (c.tasksCompleted) parts.push(plural(c.tasksCompleted, 'task completed', 'tasks completed'));
  if (c.tasksCreated) parts.push(plural(c.tasksCreated, 'task created', 'tasks created'));
  if (c.punchClosed) parts.push(plural(c.punchClosed, 'punch item closed', 'punch items closed'));
  if (c.punchCreated) parts.push(plural(c.punchCreated, 'punch item added', 'punch items added'));
  if (c.checklistDone) parts.push(plural(c.checklistDone, 'checklist item completed', 'checklist items completed'));
  if (c.partsMissing) parts.push(plural(c.partsMissing, 'part flagged missing', 'parts flagged missing'));
  if (c.partsReceived) parts.push(plural(c.partsReceived, 'part received', 'parts received'));
  if (c.photos) parts.push(plural(c.photos, 'photo uploaded', 'photos uploaded'));
  if (c.comments) parts.push(plural(c.comments, 'comment added', 'comments added'));
  if (parts.length === 0) return c.taskStatusChanges ? `${plural(c.taskStatusChanges, 'task status change', 'task status changes')}.` : 'No activity recorded.';
  return parts.join(', ') + '.';
}

// Bulk actions collapse per person: "created 30 tasks, 2:14 PM to 2:16 PM".
const COLLAPSIBLE: Record<string, { verb: string; noun: string }> = {
  task_created: { verb: 'created', noun: 'tasks' },
  punch_item_created: { verb: 'added', noun: 'punch items' },
  photo_uploaded: { verb: 'uploaded', noun: 'photos' },
};

type Line = { at: Date; html: string };

function buildPersonLines(rows: ActivityRow[], ctx: { timeZone: string; reportDateKey: string }): Line[] {
  const sorted = [...rows].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const byType = new Map<string, ActivityRow[]>();
  for (const r of sorted) {
    if (!byType.has(r.action_type)) byType.set(r.action_type, []);
    byType.get(r.action_type)!.push(r);
  }

  const timeLabel = (d: Date) => formatLocalTime(d, ctx.timeZone, localDateKey(d, ctx.timeZone) !== ctx.reportDateKey);
  const lines: Line[] = [];
  const collapsed = new Set<string>();

  for (const [type, group] of byType) {
    if (COLLAPSIBLE[type] && group.length >= COLLAPSE_THRESHOLD) {
      collapsed.add(type);
      const first = new Date(group[0].occurred_at);
      const last = new Date(group[group.length - 1].occurred_at);
      lines.push({
        at: first,
        html: `${COLLAPSIBLE[type].verb} ${group.length} ${COLLAPSIBLE[type].noun}, ${esc(timeLabel(first))} to ${esc(timeLabel(last))}`,
      });
    }
  }

  for (const r of sorted) {
    if (collapsed.has(r.action_type)) continue;
    const at = new Date(r.occurred_at);
    lines.push({ at, html: `${esc(r.description)}, ${esc(timeLabel(at))}` });
  }

  return lines.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function sectionTitle(text: string) {
  return `<h3 style="font-size:13px;letter-spacing:2px;color:#F97316;margin:28px 0 10px 0;">${esc(text)}</h3>`;
}

// windowStart = local midnight of the report day; windowEnd = when the report was built
// (or the next local midnight, if built after the day ended). The header date is the
// report day, not the build date.
function buildEmailHtml(input: {
  projectName: string; timeZone: string; windowStart: Date; windowEnd: Date; dayEnd: Date;
  rows: ActivityRow[]; truncated: boolean; names: Map<string, string>;
  crew: Crew; isTest: boolean;
}): string {
  const { timeZone, windowStart, windowEnd } = input;
  const reportDateKey = localDateKey(windowStart, timeZone);
  const c = countActivity(input.rows);

  const countRows: [string, number][] = [
    ['Tasks completed', c.tasksCompleted],
    ['Task status changes', c.taskStatusChanges],
    ['Tasks created', c.tasksCreated],
    ['Checklist items completed', c.checklistDone],
    ['Parts flagged missing', c.partsMissing],
    ['Parts received', c.partsReceived],
    ['Punch items added', c.punchCreated],
    ['Punch items closed', c.punchClosed],
    ['Photos uploaded', c.photos],
    ['Comments added', c.comments],
  ];

  const summaryTable = `
    <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:10px;overflow:hidden;">
      <tbody>
        ${countRows.map(([label, n]) => `
          <tr>
            <td style="padding:7px 12px;border-top:1px solid #1F2937;font-size:13px;color:#D1D5DB;">${esc(label)}</td>
            <td style="padding:7px 12px;border-top:1px solid #1F2937;font-size:13px;color:${n ? '#FFFFFF' : '#4B5563'};text-align:right;font-weight:700;">${n}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  // Activity grouped by person. System (null actor) last.
  const byActor = new Map<string, ActivityRow[]>();
  for (const r of input.rows) {
    const key = r.actor_id ?? '__system__';
    if (!byActor.has(key)) byActor.set(key, []);
    byActor.get(key)!.push(r);
  }
  const people = [...byActor.keys()]
    .map((key) => ({ key, name: key === '__system__' ? 'System' : (input.names.get(key) ?? 'Unknown user') }))
    .sort((a, b) => (a.key === '__system__' ? 1 : b.key === '__system__' ? -1 : a.name.localeCompare(b.name)));

  let linesRendered = 0;
  let linesHidden = 0;
  const personBlocks: string[] = [];
  for (const person of people) {
    const lines = buildPersonLines(byActor.get(person.key)!, { timeZone, reportDateKey });
    const room = Math.max(0, Math.min(MAX_LINES_PER_PERSON, MAX_LINES_TOTAL - linesRendered));
    if (room === 0) { linesHidden += lines.length; continue; }
    const shown = lines.slice(0, room);
    const more = lines.length - shown.length;
    linesRendered += shown.length;
    personBlocks.push(`
      <div style="background:#111827;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#FFFFFF;margin-bottom:6px;">${esc(person.name)}</div>
        ${shown.map((l) => `<div style="font-size:13px;color:#D1D5DB;line-height:1.6;">${l.html}</div>`).join('')}
        ${more > 0 ? `<div style="font-size:12px;color:#9CA3AF;margin-top:4px;">and ${more} more</div>` : ''}
      </div>`);
  }
  if (linesHidden > 0) {
    personBlocks.push(`<div style="font-size:12px;color:#9CA3AF;">and ${linesHidden} more activity entries not shown</div>`);
  }
  if (input.truncated) {
    personBlocks.push(`<div style="font-size:12px;color:#9CA3AF;">Activity volume exceeded ${MAX_ACTIVITY_ROWS} entries; counts above cover the first ${MAX_ACTIVITY_ROWS}.</div>`);
  }

  const activitySection = input.rows.length === 0
    ? `<p style="font-size:13px;color:#6B7280;">No activity recorded so far today.</p>`
    : personBlocks.join('');

  const crewMore = input.crew.total - input.crew.entries.length;
  const crewSection = input.crew.entries.length === 0
    ? `<p style="font-size:13px;color:#6B7280;">No clock-ins recorded.</p>`
    : `<div style="background:#111827;border-radius:10px;padding:12px 14px;">${input.crew.entries.map((e) => {
        const inDate = localDateKey(e.clockIn, timeZone) !== reportDateKey;
        const out = e.clockOut
          ? formatLocalTime(e.clockOut, timeZone, localDateKey(e.clockOut, timeZone) !== reportDateKey)
          : 'still clocked in';
        return `<div style="font-size:13px;color:#D1D5DB;line-height:1.6;">${esc(e.name)}: ${esc(formatLocalTime(e.clockIn, timeZone, inDate))} to ${esc(out)}</div>`;
      }).join('')}${crewMore > 0 ? `<div style="font-size:12px;color:#9CA3AF;margin-top:4px;">and ${crewMore} more</div>` : ''}</div>`;

  const endLabel = windowEnd.getTime() >= input.dayEnd.getTime() ? 'midnight' : formatLocalTime(windowEnd, timeZone, false);
  const coverage = `Covers this day only, from ${formatLocalTime(windowStart, timeZone, false)} to ${endLabel} ${tzAbbrev(windowStart, timeZone)}`;

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
      <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
      <p style="color:#6B7280;font-size:13px;margin:0 0 24px 0;">${input.isTest ? 'DAILY REPORT (TEST SEND)' : 'DAILY REPORT'}</p>
      <h2 style="font-size:20px;color:#FFFFFF;margin:0 0 4px 0;">${esc(input.projectName)}</h2>
      <p style="font-size:14px;color:#D1D5DB;margin:0 0 4px 0;">${esc(formatLocalDate(windowStart, timeZone))}</p>
      <p style="font-size:12px;color:#6B7280;margin:0 0 8px 0;">${esc(coverage)}</p>

      ${sectionTitle('SUMMARY')}
      <p style="font-size:14px;color:#FFFFFF;margin:0 0 12px 0;">${esc(rollupSentence(c))}</p>
      ${summaryTable}

      ${sectionTitle('ACTIVITY BY PERSON')}
      ${activitySection}

      ${sectionTitle('CREW ON SITE')}
      ${crewSection}

      <p style="color:#6B7280;font-size:12px;margin-top:28px;">
        ${input.isTest
          ? 'This is a test send to this address only. It did not change the next scheduled report.'
          : 'You are receiving this because you are on the daily report list for this project. Project admins and managers can change recipients in the project settings.'}
      </p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type SendOutcome =
  | { status: 'sent' }
  | { status: 'rejected'; error: string }    // definitely not delivered: safe to undo the claim and retry
  | { status: 'ambiguous'; error: string };  // may have been delivered: never retry with a new payload

// One message per recipient (addresses never exposed to each other), sent as ONE batch
// request so delivery is all-or-nothing:
//  - x-batch-validation: strict (Resend's default, set explicitly): if any message fails
//    validation the whole batch is rejected and nothing is sent. No partial batches.
//  - Idempotency-Key: a transient failure is retried once immediately with the identical
//    payload and key, so if the first attempt actually went through Resend returns the
//    original result instead of sending again.
//  - A 4xx (validation, auth, rate limit) means nothing was sent -> 'rejected'.
//  - A 5xx / timeout / network error that persists after the retry -> 'ambiguous'.
async function sendBatch(recipients: Recipient[], subject: string, html: string, idempotencyKey: string): Promise<SendOutcome> {
  const body = JSON.stringify(recipients.map((r) => ({ from: FROM, to: r.email, subject, html })));
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'x-batch-validation': 'strict',
        },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return { status: 'sent' };
      const text = await res.text().catch(() => '');
      lastError = `Resend ${res.status}: ${text.slice(0, 300)}`;
      // 409 = idempotency key in flight / reused: an earlier attempt may have been accepted.
      if (res.status >= 400 && res.status < 500 && res.status !== 409) return { status: 'rejected', error: lastError };
    } catch (e: any) {
      lastError = `Resend request failed: ${e?.message ?? e}`;
    }
    if (attempt === 1) await sleep(1500);
  }
  return { status: 'ambiguous', error: lastError };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function subjectFor(projectName: string, buildTime: Date, timeZone: string, isTest: boolean) {
  const d = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(buildTime);
  return `${isTest ? '[Test] ' : ''}Daily Report: ${projectName} - ${d}`;
}

// ---------------------------------------------------------------------------
// Cron mode
// ---------------------------------------------------------------------------

async function runCron(admin: SupabaseClient) {
  const now = new Date();
  const summary = {
    success: true,
    mode: 'cron',
    projects_processed: 0,
    projects_sent: 0,
    emails_sent: 0,
    projects_skipped: { no_activity: 0, no_recipients: 0, already_sent: 0, outside_window: 0, not_due: 0, archived: 0 },
    recipients_skipped_no_email: 0,
    archive: { archived: 0, kept_existing: 0, archive_failed: 0 },
    failures: [] as { project_id: string; error: string }[],
  };

  const { data: settings, error } = await admin
    .from('project_report_settings')
    .select('project_id, send_time, timezone, last_report_cutoff, last_sent_date, project:project_id (id, name, archived)')
    .eq('enabled', true);
  if (error) throw error;

  for (const s of (settings ?? []) as any[]) {
    summary.projects_processed++;
    const projectId: string = s.project_id;
    try {
      if (!s.project || s.project.archived) { summary.projects_skipped.archived++; continue; }

      // last_report_cutoff is the moment the setting was switched on. It is used ONLY to skip
      // a send time that had already passed when reports were enabled; it never defines the
      // report window.
      const enabledAt = s.last_report_cutoff ? new Date(s.last_report_cutoff) : new Date(0);
      const due = evaluateDue(now, s.send_time, s.timezone, enabledAt, s.last_sent_date);
      if (due.state !== 'due') { summary.projects_skipped[due.state]++; continue; }

      // The report covers the scheduled day only: local midnight .. now (or that day's end,
      // when a near-midnight send runs after midnight).
      const buildTime = now;
      const win = dayWindow(due.scheduledDate, s.timezone, buildTime);

      // Claim this scheduled day atomically (compare-and-set on last_sent_date) so
      // overlapping invocations can never both send.
      let claim = admin.from('project_report_settings')
        .update({ last_sent_date: due.scheduledDate })
        .eq('project_id', projectId)
        .eq('enabled', true);
      claim = s.last_sent_date ? claim.eq('last_sent_date', s.last_sent_date) : claim.is('last_sent_date', null);
      const { data: claimed, error: claimError } = await claim.select('project_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) { summary.projects_skipped.already_sent++; continue; }

      // Release the claim so the next 15-minute tick INSIDE the 2-hour window can retry the
      // same day. Once the window passes, that day is simply never sent; nothing from it is
      // carried into any later report (every report is bounded to its own calendar day).
      const release = async (reason: string) => {
        const { error: releaseError } = await admin.from('project_report_settings')
          .update({ last_sent_date: s.last_sent_date })
          .eq('project_id', projectId)
          .eq('last_sent_date', due.scheduledDate);
        if (releaseError) console.error(`Project ${projectId}: failed to release claim after ${reason}:`, releaseError.message);
      };

      const { rows, truncated } = await loadActivity(admin, projectId, win.start, win.end);
      if (rows.length === 0) {
        // Zero activity that day: send nothing; the day is done.
        summary.projects_skipped.no_activity++;
        continue;
      }

      const { recipients, skippedNoEmail } = await resolveRecipients(admin, projectId);
      summary.recipients_skipped_no_email += skippedNoEmail;
      if (recipients.length === 0) {
        // Retry within the window only (someone may add a recipient); never carried forward.
        await release('no recipients');
        summary.projects_skipped.no_recipients++;
        continue;
      }

      const [names, crew] = await Promise.all([
        loadNames(admin, rows.map((r) => r.actor_id).filter(Boolean) as string[]),
        loadCrew(admin, projectId, win.start, win.end),
      ]);

      const html = buildEmailHtml({
        projectName: s.project.name, timeZone: s.timezone, windowStart: win.start, windowEnd: win.end, dayEnd: win.dayEnd,
        rows, truncated, names, crew, isTest: false,
      });

      const subject = subjectFor(s.project.name, win.start, s.timezone, false);
      const result = await sendBatch(
        recipients, subject, html,
        `daily-report/${projectId}/${due.scheduledDate}/${buildTime.getTime()}`,
      );

      // Archive (scheduled sends only; never affects the send outcome below).
      const archive = (status: ArchiveStatus, error: string | null) => archiveSend(admin, {
        projectId, reportDate: due.scheduledDate, status, scheduledAt: due.scheduledAt,
        sentAt: status === 'failed' ? null : new Date(), recipients: recipients.map((r) => r.email),
        subject, html, error,
        summary: {
          activity_count: rows.length, activity_truncated: truncated, crew_count: crew.total,
          window_start: win.start.toISOString(), window_end: win.end.toISOString(),
          time_zone: s.timezone, counts: countActivity(rows),
        },
      }).then((r) => { summary.archive[r]++; });

      if (result.status === 'rejected') {
        // Definite 4xx, nothing delivered: release so the next tick in the window retries.
        await archive('failed', result.error);
        await release('send rejected');
        summary.failures.push({ project_id: projectId, error: result.error });
        continue;
      }
      if (result.status === 'ambiguous') {
        // Possibly delivered. Keep the claim so no recipient can get this report twice;
        // the trade-off is that a genuinely undelivered report is not resent automatically.
        console.error(`Project ${projectId}: delivery uncertain for ${due.scheduledDate} (${win.start.toISOString()} .. ${win.end.toISOString()}): ${result.error}`);
        await archive('delivery_uncertain', result.error);
        summary.failures.push({ project_id: projectId, error: `delivery uncertain (not retried): ${result.error}` });
        continue;
      }

      await archive('sent', null);
      await admin.from('project_report_settings').update({ last_sent_at: new Date().toISOString() }).eq('project_id', projectId);
      summary.projects_sent++;
      summary.emails_sent += recipients.length;
      await sleep(600); // stay under Resend's default rate limit across projects
    } catch (e: any) {
      console.error(`Project ${projectId}: report failed:`, e?.message ?? e);
      summary.failures.push({ project_id: projectId, error: e?.message ?? String(e) });
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------

const TEST_SENDS_PER_PROJECT_PER_HOUR = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Test mode. The browser sends only { projectId, recipientId? }; it never sends an address.
//  - no recipientId: send to the caller's LOGIN email (auth.users, from the verified JWT's
//    user record), not profiles.email.
//  - recipientId: must be a row in this project's project_report_recipients, resolved exactly
//    as the scheduled send resolves it (profiles.email for team members, the stored address
//    for external emails).
async function runTest(admin: SupabaseClient, token: string, projectId: unknown, recipientId: unknown) {
  // Authenticate before looking at the request body.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);
  const user = userData.user;

  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) {
    return json({ success: false, error: 'projectId is required' }, 400);
  }
  if (recipientId !== undefined && recipientId !== null && (typeof recipientId !== 'string' || !UUID_RE.test(recipientId))) {
    return json({ success: false, error: 'Invalid recipient' }, 400);
  }

  // Permission check runs as the caller, so auth.uid() is theirs.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: canManage, error: rpcError } = await asUser.rpc('can_manage_project_reports', { p_project_id: projectId });
  if (rpcError) throw rpcError;
  if (canManage !== true) return json({ success: false, error: 'Only company admins and project managers can send a test report for this project' }, 403);

  const [{ data: project, error: projectError }, { data: settings }] = await Promise.all([
    admin.from('projects').select('id, name').eq('id', projectId).single(),
    admin.from('project_report_settings').select('timezone').eq('project_id', projectId).maybeSingle(),
  ]);
  if (projectError || !project) return json({ success: false, error: 'Project not found' }, 404);

  // Resolve the destination server-side.
  let email = '';
  const target: 'self' | 'recipient' = recipientId ? 'recipient' : 'self';
  if (target === 'self') {
    email = (user.email ?? '').trim();
    if (!email) return json({ success: false, error: 'Your login has no email address' }, 400);
  } else {
    const { data: rec, error: recError } = await admin
      .from('project_report_recipients')
      .select('id, user_id, email')
      .eq('id', recipientId as string)
      .eq('project_id', projectId)
      .maybeSingle();
    if (recError) throw recError;
    if (!rec) return json({ success: false, error: 'That recipient is not on this project\'s report list' }, 404);
    if (rec.user_id) {
      const { data: p } = await admin.from('profiles').select('email').eq('id', rec.user_id).maybeSingle();
      email = (p?.email ?? '').trim();
      if (!email) return json({ success: false, error: 'That team member has no email on file, so the scheduled report would skip them too' }, 400);
    } else {
      email = (rec.email ?? '').trim();
    }
  }

  // Rate limit: counts every attempt (sent or failed) for this project in the last hour.
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const { data: recent, error: recentError } = await admin
    .from('daily_report_test_sends')
    .select('created_at')
    .eq('project_id', projectId)
    .gte('created_at', hourAgo.toISOString())
    .order('created_at', { ascending: true });
  if (recentError) throw recentError;
  if ((recent ?? []).length >= TEST_SENDS_PER_PROJECT_PER_HOUR) {
    const retryAt = new Date(new Date(recent![0].created_at).getTime() + 3600 * 1000);
    return json({
      success: false,
      error: `Test send limit reached (${TEST_SENDS_PER_PROJECT_PER_HOUR} per project per hour). Try again after ${formatLocalTime(retryAt, settings?.timezone ?? 'America/Chicago', false)}.`,
    }, 429);
  }

  const { data: logRow, error: logError } = await admin
    .from('daily_report_test_sends')
    .insert({ project_id: projectId, requested_by: user.id, target, recipient_id: target === 'recipient' ? recipientId : null, sent_to: email })
    .select('id')
    .single();
  if (logError) throw logError;
  const finishLog = (status: 'sent' | 'failed', error: string | null = null) =>
    admin.from('daily_report_test_sends').update({ status, error }).eq('id', logRow.id);

  const timeZone = settings?.timezone ?? 'America/Chicago';
  const buildTime = new Date();
  // Today's report so far: the project's local calendar day, from local midnight to now.
  const win = dayWindow(localDateOf(buildTime, timeZone), timeZone, buildTime);

  const { rows, truncated } = await loadActivity(admin, projectId, win.start, win.end);
  const [names, crew] = await Promise.all([
    loadNames(admin, rows.map((r) => r.actor_id).filter(Boolean) as string[]),
    loadCrew(admin, projectId, win.start, win.end),
  ]);

  const html = buildEmailHtml({
    projectName: project.name, timeZone, windowStart: win.start, windowEnd: win.end, dayEnd: win.dayEnd,
    rows, truncated, names, crew, isTest: true,
  });

  const result = await sendBatch([{ email }], subjectFor(project.name, win.start, timeZone, true), html,
    `daily-report-test/${logRow.id}`);
  if (result.status !== 'sent') {
    await finishLog('failed', result.error.slice(0, 500));
    return json({ success: false, error: result.error }, 502);
  }
  await finishLog('sent');

  return json({ success: true, mode: 'test', sent_to: email, activity_count: rows.length });
}

// ---------------------------------------------------------------------------

// Reads the `role` claim from a JWT payload WITHOUT verifying the signature.
//
// SECURITY: this is only safe because this function is deployed with verify_jwt = true
// (see supabase/config.toml, [functions.send-daily-reports]). The Supabase gateway
// verifies the JWT signature and rejects invalid or forged tokens with a 401 before this
// code ever runs, so by the time we get here the claims are authentic. If verify_jwt is
// ever turned off for this function, this check becomes forgeable and MUST be replaced
// with real signature verification.
//
// Never log the token or any part of it.
function verifiedJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims = JSON.parse(atob(b64));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ success: false, error: 'Not authenticated' }, 401);

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey, { auth: { persistSession: false } });

    // Cron mode: any gateway-verified service-role credential. pg_cron sends the legacy
    // service_role JWT stored in vault, which is a different (still valid) value from this
    // function's SUPABASE_SERVICE_ROLE_KEY, so an exact string comparison is not enough.
    if ((serviceKey && token === serviceKey) || verifiedJwtRole(token) === 'service_role') {
      return json(await runCron(admin));
    }

    const body = await req.json().catch(() => ({}));
    return await runTest(admin, token, (body as any)?.projectId, (body as any)?.recipientId);
  } catch (error: any) {
    console.error('send-daily-reports error:', error?.message ?? error);
    return json({ success: false, error: error?.message ?? 'Unexpected error' }, 500);
  }
});
