import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';
import { corsHeaders, json, bearer, isServiceRole, resolveRecipients, esc, sleep, toBase64, FROM, UUID_RE, Recipient } from '../_shared/common.ts';
import { buildWorkbook, loadExportData, exportFileName, ExportCounts } from '../_shared/project_export.ts';
import { evaluateDue, localDateOf, formatLocalDate, formatLocalTime, tzAbbrev } from '../_shared/schedule.ts';
import { normalizeFrequency, isSendDay, shouldSkipUnchanged, exportFingerprint, ExportFrequency } from '../_shared/export_schedule.ts';

// send-project-export (verify_jwt = true)
//
// End-of-day email with the project's spreadsheet attached. A SEPARATE email from the daily
// report, with the same recipients (the project's saved list, max 25) and the same send time,
// timezone and 2-hour window. Per-project switch: project_report_settings.export_email_enabled
// (default OFF). Skipped when the project has no tasks.
//
// "Send when" (project_report_settings.export_frequency, see _shared/export_schedule.ts):
//   'daily' every day; 'daily_if_changed' every day only if the data changed since the last
//   send that reached a recipient; 'weekly' on export_weekday, also only if changed. A day
//   skipped for "nothing changed" stays handled (no retries that day) and is recorded in
//   export_last_outcome. The fingerprint is saved only when at least one recipient got the email.
//
//  - Cron mode (service-role token; pg_cron every 15 min).
//  - Dry run (service-role token, body { mode: 'dry_run', now?, overrides? }): evaluates every
//    project exactly like cron mode at the given time and reports each decision. Never claims,
//    sends or writes anything. overrides: { [projectId]: { frequency?, weekday?, send_time?,
//    timezone?, last_sent_date?, last_sent_hash? } } simulate settings without changing them.
//  - Test mode (user JWT, body { projectId }): company admin/PM only; sends to the caller's LOGIN
//    email only; 5 test sends per project per hour. Always sends (no "changed" check).

const APP_URL = 'https://app.fieldopspro.org';
//
// Resend's batch endpoint does not accept attachments, so each recipient gets an individual
// request with its own Idempotency-Key (a retry can never send that recipient a second copy).

const TEST_SENDS_PER_PROJECT_PER_HOUR = 5;

type SendOutcome = { status: 'sent' } | { status: 'rejected'; error: string } | { status: 'ambiguous'; error: string };

async function sendOne(to: string, subject: string, html: string, filename: string, base64: string, idempotencyKey: string): Promise<SendOutcome> {
  const body = JSON.stringify({ from: FROM, to, subject, html, attachments: [{ filename, content: base64 }] });
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return { status: 'sent' };
      const text = await res.text().catch(() => '');
      lastError = `Resend ${res.status}: ${text.slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 409) return { status: 'rejected', error: lastError };
    } catch (e: any) {
      lastError = `Resend request failed: ${e?.message ?? e}`;
    }
    if (attempt === 1) await sleep(1500);
  }
  return { status: 'ambiguous', error: lastError };
}

type EmailExtras = { projectId: string; asOf: string; weekly: boolean };

function emailHtml(projectName: string, dateLabel: string, c: ExportCounts, isTest: boolean, x: EmailExtras) {
  const kind = x.weekly ? 'WEEKLY PROJECT SPREADSHEET' : 'PROJECT SPREADSHEET';
  const projectUrl = `${APP_URL}/projects/${encodeURIComponent(x.projectId)}`;
  const stat = (label: string, n: number) =>
    `<td style="padding:10px 14px;background:#111827;border-radius:8px;text-align:center;">
       <div style="font-size:20px;font-weight:700;color:#FFFFFF;">${n}</div>
       <div style="font-size:12px;color:#9CA3AF;">${esc(label)}</div></td>`;
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
      <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
      <p style="color:#6B7280;font-size:13px;margin:0 0 24px 0;">${isTest ? `${kind} (TEST SEND)` : kind}</p>
      <h2 style="font-size:20px;color:#FFFFFF;margin:0 0 4px 0;">${esc(projectName)}</h2>
      <p style="font-size:14px;color:#D1D5DB;margin:0 0 20px 0;">${esc(dateLabel)}</p>
      <table style="border-collapse:separate;border-spacing:8px 0;margin-left:-8px;"><tr>
        ${stat('Open', c.open)}${stat('In Progress', c.in_progress)}${stat('Done', c.done)}
      </tr></table>
      <p style="font-size:13px;color:#D1D5DB;margin:20px 0 0 0;">The attached spreadsheet is current as of ${esc(x.asOf)}.</p>
      <p style="margin:20px 0 0 0;">
        <a href="${esc(projectUrl)}" style="display:inline-block;padding:10px 18px;background:#F97316;color:#0A0F1E;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Download the latest spreadsheet</a>
      </p>
      <p style="font-size:12px;color:#6B7280;margin:8px 0 0 0;">Opens the project in FieldOps (sign-in required), where the newest file is always available.</p>
      <p style="color:#6B7280;font-size:12px;margin-top:24px;">
        ${isTest ? 'This is a test send to you only.' : 'You are receiving this because you are on the report list for this project. Project admins and managers can change recipients in the project settings.'}
      </p>
    </div>`;
}

async function buildAttachment(admin: SupabaseClient, projectId: string, timeZone: string, when: Date) {
  const data = await loadExportData(admin, projectId);
  if (!data) return null;
  const { workbook, counts } = buildWorkbook(ExcelJS, data);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const localDate = localDateOf(when, timeZone);
  return { data, counts, base64: toBase64(bytes), filename: exportFileName(data.project.name, localDate), localDate };
}

type DryRunOverride = {
  frequency?: string; weekday?: number | null; send_time?: string; timezone?: string;
  last_sent_date?: string | null; last_sent_hash?: string | null;
};
type DryRun = { now?: string; overrides?: Record<string, DryRunOverride> };

function asOfLabel(at: Date, timeZone: string) {
  return `${formatLocalTime(at, timeZone, false)} ${tzAbbrev(at, timeZone)}`;
}

async function recordOutcome(admin: SupabaseClient, projectId: string, outcome: 'sent' | 'skipped_no_changes' | 'failed', extra: Record<string, unknown> = {}) {
  const { error } = await admin.from('project_report_settings')
    .update({ export_last_outcome: outcome, export_last_outcome_at: new Date().toISOString(), ...extra })
    .eq('project_id', projectId);
  if (error) console.error(`Project ${projectId}: recording outcome '${outcome}' failed: ${error.message}`);
}

async function runCron(admin: SupabaseClient, dry: DryRun | null = null) {
  const now = dry?.now ? new Date(dry.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('dry_run: invalid "now"');
  const summary = {
    success: true, mode: dry ? 'dry_run' : 'cron', now: now.toISOString(),
    projects_processed: 0, projects_sent: 0, emails_sent: 0,
    projects_skipped: { no_tasks: 0, no_recipients: 0, already_sent: 0, outside_window: 0, not_due: 0, archived: 0, not_send_day: 0, unchanged: 0 },
    recipients_skipped_no_email: 0,
    failures: [] as { project_id: string; error: string }[],
    decisions: [] as Record<string, unknown>[],   // dry run only
  };

  const { data: settings, error } = await admin
    .from('project_report_settings')
    .select('project_id, send_time, timezone, export_enabled_at, export_last_sent_date, export_frequency, export_weekday, export_last_sent_hash, project:project_id (id, name, archived)')
    .eq('export_email_enabled', true);
  if (error) throw error;

  for (const s of (settings ?? []) as any[]) {
    summary.projects_processed++;
    const projectId: string = s.project_id;
    // Dry run may simulate settings; cron mode always uses the stored values.
    const o: DryRunOverride = dry?.overrides?.[projectId] ?? {};
    const has = (k: keyof DryRunOverride) => dry !== null && Object.prototype.hasOwnProperty.call(o, k);
    const frequency: ExportFrequency = normalizeFrequency(has('frequency') ? o.frequency : s.export_frequency);
    const weekday: number | null = has('weekday') ? (o.weekday ?? null) : (s.export_weekday ?? null);
    const sendTime: string = has('send_time') ? o.send_time! : s.send_time;
    const timeZone: string = has('timezone') ? o.timezone! : s.timezone;
    const lastSentDate: string | null = has('last_sent_date') ? (o.last_sent_date ?? null) : s.export_last_sent_date;
    const lastHash: string | null = has('last_sent_hash') ? (o.last_sent_hash ?? null) : (s.export_last_sent_hash ?? null);
    const decision: Record<string, unknown> = { project_id: projectId, project: s.project?.name ?? null, frequency, weekday, send_time: sendTime, timezone: timeZone };
    const decide = (result: string, more: Record<string, unknown> = {}) => { if (dry) summary.decisions.push({ ...decision, ...more, result }); };
    try {
      if (!s.project || s.project.archived) { summary.projects_skipped.archived++; decide('skip: archived'); continue; }
      const enabledAt = s.export_enabled_at ? new Date(s.export_enabled_at) : new Date(0);
      const due = evaluateDue(now, sendTime, timeZone, enabledAt, lastSentDate);
      if (due.state !== 'due') { summary.projects_skipped[due.state]++; decide(`skip: ${due.state}`); continue; }
      Object.assign(decision, { scheduled_date: due.scheduledDate, scheduled_at: due.scheduledAt.toISOString() });
      if (!isSendDay(frequency, weekday, due.scheduledDate)) { summary.projects_skipped.not_send_day++; decide('skip: not the weekly send day'); continue; }

      if (dry) {
        // Same reads as a real run; no claim, no send, no write.
        const loadedAt = new Date();
        const att = await buildAttachment(admin, projectId, timeZone, now);
        if (!att) { summary.projects_skipped.archived++; decide('skip: project not found'); continue; }
        const hash = await exportFingerprint(att.data);
        const more = { fingerprint: hash, last_sent_hash: lastHash, tasks_total: att.counts.total, as_of: asOfLabel(loadedAt, timeZone) };
        if (att.counts.total === 0) { summary.projects_skipped.no_tasks++; decide('skip: no tasks', more); continue; }
        if (shouldSkipUnchanged(frequency, lastHash, hash)) { summary.projects_skipped.unchanged++; decide('skip: nothing changed since the last send', more); continue; }
        const { recipients, skippedNoEmail } = await resolveRecipients(admin, projectId);
        decide(recipients.length === 0 ? 'skip: no recipients' : 'would send', { ...more, recipients: recipients.length, recipients_skipped_no_email: skippedNoEmail });
        continue;
      }

      // Claim this scheduled day (compare-and-set on export_last_sent_date).
      let claim = admin.from('project_report_settings').update({ export_last_sent_date: due.scheduledDate })
        .eq('project_id', projectId).eq('export_email_enabled', true);
      claim = s.export_last_sent_date ? claim.eq('export_last_sent_date', s.export_last_sent_date) : claim.is('export_last_sent_date', null);
      const { data: claimed, error: claimError } = await claim.select('project_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) { summary.projects_skipped.already_sent++; continue; }
      const release = async () => {
        await admin.from('project_report_settings').update({ export_last_sent_date: s.export_last_sent_date })
          .eq('project_id', projectId).eq('export_last_sent_date', due.scheduledDate);
      };

      const loadedAt = new Date();
      const att = await buildAttachment(admin, projectId, s.timezone, now);
      if (!att) { summary.projects_skipped.archived++; continue; }
      if (att.counts.total === 0) { summary.projects_skipped.no_tasks++; continue; }   // day handled, nothing sent

      // Nothing changed since the last send that reached someone: keep the day claimed (no retries
      // today) and record the skip.
      const hash = await exportFingerprint(att.data);
      if (shouldSkipUnchanged(frequency, lastHash, hash)) {
        await recordOutcome(admin, projectId, 'skipped_no_changes');
        summary.projects_skipped.unchanged++;
        continue;
      }

      const { recipients, skippedNoEmail } = await resolveRecipients(admin, projectId);
      summary.recipients_skipped_no_email += skippedNoEmail;
      if (recipients.length === 0) { await release(); summary.projects_skipped.no_recipients++; continue; }

      const dateLabel = formatLocalDate(due.scheduledAt, s.timezone);
      const subject = `Project spreadsheet: ${att.data.project.name} - ${dateLabel}`;
      const html = emailHtml(att.data.project.name, dateLabel, att.counts, false,
        { projectId, asOf: asOfLabel(loadedAt, s.timezone), weekly: frequency === 'weekly' });

      let sent = 0, rejected = 0, ambiguous = 0;
      for (const r of recipients as Recipient[]) {
        const out = await sendOne(r.email, subject, html, att.filename, att.base64,
          `project-export/${projectId}/${due.scheduledDate}/${r.email.toLowerCase()}`);
        if (out.status === 'sent') sent++;
        else if (out.status === 'rejected') { rejected++; summary.failures.push({ project_id: projectId, error: out.error }); }
        else { ambiguous++; summary.failures.push({ project_id: projectId, error: `delivery uncertain: ${out.error}` }); }
        await sleep(600); // Resend default rate limit
      }
      // Nothing delivered and nothing uncertain: release so the next tick in the window retries.
      // Any delivered or uncertain recipient: keep the claim, so nobody gets a second copy.
      if (sent === 0 && ambiguous === 0) { await release(); await recordOutcome(admin, projectId, 'failed'); continue; }
      await admin.from('project_report_settings').update({ export_last_sent_at: new Date().toISOString() }).eq('project_id', projectId);
      // The fingerprint counts as "last sent" only when at least one recipient got the email.
      if (sent > 0) await recordOutcome(admin, projectId, 'sent', { export_last_sent_hash: hash });
      else await recordOutcome(admin, projectId, 'failed');
      summary.projects_sent++;
      summary.emails_sent += sent;
    } catch (e: any) {
      decide('error', { error: e?.message ?? String(e) });
      console.error(`Project ${projectId}: spreadsheet email failed:`, e?.message ?? e);
      summary.failures.push({ project_id: projectId, error: e?.message ?? String(e) });
    }
  }
  return summary;
}

async function runTest(admin: SupabaseClient, token: string, projectId: unknown) {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);
  const user = userData.user;
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return json({ success: false, error: 'projectId is required' }, 400);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: canManage, error: rpcError } = await asUser.rpc('can_manage_project_reports', { p_project_id: projectId });
  if (rpcError) throw rpcError;
  if (canManage !== true) return json({ success: false, error: 'Only company admins and project managers can send a test spreadsheet for this project' }, 403);

  const email = (user.email ?? '').trim();
  if (!email) return json({ success: false, error: 'Your login has no email address' }, 400);

  const { data: settings } = await admin.from('project_report_settings').select('timezone').eq('project_id', projectId).maybeSingle();
  const timeZone = settings?.timezone ?? 'America/Chicago';

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const { data: recent, error: recentError } = await admin.from('project_export_test_sends').select('created_at')
    .eq('project_id', projectId).gte('created_at', hourAgo.toISOString()).order('created_at', { ascending: true });
  if (recentError) throw recentError;
  if ((recent ?? []).length >= TEST_SENDS_PER_PROJECT_PER_HOUR) {
    const retryAt = new Date(new Date(recent![0].created_at).getTime() + 3600 * 1000);
    return json({ success: false, error: `Test send limit reached (${TEST_SENDS_PER_PROJECT_PER_HOUR} per project per hour). Try again after ${retryAt.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })}.` }, 429);
  }

  const loadedAt = new Date();
  const att = await buildAttachment(admin, projectId, timeZone, loadedAt);
  if (!att) return json({ success: false, error: 'Project not found' }, 404);

  const { data: logRow, error: logError } = await admin.from('project_export_test_sends')
    .insert({ project_id: projectId, requested_by: user.id, sent_to: email }).select('id').single();
  if (logError) throw logError;

  const dateLabel = formatLocalDate(new Date(), timeZone);
  const out = await sendOne(email, `[Test] Project spreadsheet: ${att.data.project.name} - ${dateLabel}`,
    emailHtml(att.data.project.name, dateLabel, att.counts, true, { projectId, asOf: asOfLabel(loadedAt, timeZone), weekly: false }),
    att.filename, att.base64, `project-export-test/${logRow.id}`);
  if (out.status !== 'sent') {
    await admin.from('project_export_test_sends').update({ status: 'failed', error: out.error.slice(0, 500) }).eq('id', logRow.id);
    return json({ success: false, error: out.error }, 502);
  }
  await admin.from('project_export_test_sends').update({ status: 'sent' }).eq('id', logRow.id);
  return json({ success: true, mode: 'test', sent_to: email, counts: att.counts, tasks_total: att.counts.total });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = bearer(req);
    if (!token) return json({ success: false, error: 'Not authenticated' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    if (isServiceRole(token)) {
      if ((body as any)?.mode === 'dry_run') {
        const b = body as any;
        return json(await runCron(admin, { now: typeof b.now === 'string' ? b.now : undefined, overrides: b.overrides && typeof b.overrides === 'object' ? b.overrides : undefined }));
      }
      return json(await runCron(admin));
    }
    return await runTest(admin, token, (body as any)?.projectId);
  } catch (e: any) {
    console.error('send-project-export error:', e?.message ?? e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' }, 500);
  }
});
