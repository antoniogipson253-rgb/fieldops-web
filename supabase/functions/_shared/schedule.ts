// Schedule + time-zone helpers for scheduled project emails.
// COPIED VERBATIM from send-daily-reports/index.ts (tested there: DST days, 2-hour window,
// near-midnight send times). send-daily-reports keeps its own copy so it is unaffected.

export const SEND_WINDOW_MS = 2 * 60 * 60 * 1000;   // send no later than send_time + 2h

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function zonedParts(date: Date, timeZone: string): ZonedParts {
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
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Local wall-clock time in `timeZone` -> UTC instant.
//  - Ambiguous times (fall back) resolve to the first occurrence.
//  - Nonexistent times (spring forward gap) resolve forward past the gap (02:30 -> 03:30).
export function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(new Date(guess), timeZone);
  const utc1 = guess - off1;
  const off2 = tzOffsetMs(new Date(utc1), timeZone);
  if (off2 === off1) return new Date(utc1);
  const utc2 = guess - off2;
  if (tzOffsetMs(new Date(utc2), timeZone) === off2) return new Date(utc2);
  return new Date(Math.max(utc1, utc2)); // inside a DST gap
}

export function addDays(y: number, m: number, d: number, delta: number) {
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const [h, m] = sendTime.split(':').map(Number);
  return { hour: h, minute: m };
}

export type DueState =
  | { state: 'due'; scheduledAt: Date; scheduledDate: string }
  | { state: 'already_sent' | 'outside_window' | 'not_due' };

export const dateKey = (d: { year: number; month: number; day: number }) =>
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

export function formatLocalTime(date: Date, timeZone: string, includeDate: boolean): string {
  const opts: Intl.DateTimeFormatOptions = includeDate
    ? { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { timeZone, hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat('en-US', opts).format(date);
}

export function formatLocalDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

export function localDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function tzAbbrev(date: Date, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}
