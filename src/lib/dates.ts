// Date-only columns (tasks.due_date, rfis.due_date, report_date) come back as "YYYY-MM-DD".
// `new Date("2026-11-18")` reads that as midnight UTC, which is the evening of Nov 17 in US time
// zones, so dates showed a day early and turned overdue the evening before. These helpers treat the
// value as a plain calendar day instead.

/** A date's local calendar day as YYYY-MM-DD (defaults to today). */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses a YYYY-MM-DD value as local midnight of that day (null if it isn't one). */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Shows a date-only value as that calendar day. */
export function formatDateOnly(value: string, options?: Intl.DateTimeFormatOptions): string {
  const d = parseDateOnly(value);
  return (d ?? new Date(value)).toLocaleDateString(options ? 'en-US' : undefined, options);
}

/** True when the due day is before today (local). A task due today is not overdue yet. */
export function isPastDue(value: string | null | undefined): boolean {
  if (!value) return false;
  return String(value).slice(0, 10) < localDateKey();
}
