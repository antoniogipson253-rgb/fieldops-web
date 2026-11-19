// "Send when" rules for the spreadsheet email (send-project-export). Pure helpers with no
// imports, so the same code runs in the edge runtime and in offline Node tests.
//
//  - 'daily'            : every day at the send time (the behaviour before this setting).
//  - 'daily_if_changed' : every day at the send time, only if the data changed since the last
//                         send that reached a recipient.
//  - 'weekly'           : on export_weekday (0 = Sunday, project time zone) at the send time,
//                         only if the data changed since the last send that reached a recipient.
//
// "Changed" = the SHA-256 fingerprint of the spreadsheet's source data differs from the one
// saved at the last successful send. No saved fingerprint (never sent, or the email was just
// switched on again) = changed, so that send always goes out.

export type ExportFrequency = 'daily' | 'daily_if_changed' | 'weekly';

export const FREQUENCIES: ExportFrequency[] = ['daily', 'daily_if_changed', 'weekly'];

/** Unknown or missing values behave like 'daily', the behaviour before this setting existed. */
export function normalizeFrequency(value: unknown): ExportFrequency {
  return FREQUENCIES.includes(value as ExportFrequency) ? (value as ExportFrequency) : 'daily';
}

/** Weekday (0 = Sunday) of a project-local calendar date 'YYYY-MM-DD'. Independent of any time zone. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whether a scheduled local date is a send day for this frequency. */
export function isSendDay(frequency: ExportFrequency, weekday: number | null, scheduledDate: string): boolean {
  if (frequency !== 'weekly') return true;
  return weekday !== null && weekday === weekdayOfDateKey(scheduledDate);
}

/** Skip only when the setting asks for it AND the data provably did not change. */
export function shouldSkipUnchanged(frequency: ExportFrequency, lastHash: string | null, currentHash: string): boolean {
  if (frequency === 'daily') return false;
  return lastHash !== null && lastHash === currentHash;
}

type FingerprintInput = {
  project: { id: string; name: string; project_type: string };
  folders: { id: string; name: string; created_at: string; checklist_managed: boolean }[];
  folderItems: { id: string; folder_id: string; item_text: string; sort_order: number }[];
  tasks: { id: string; folder_id: string | null; title: string; description: string | null; status: string; due_date: string | null; archived: boolean | null; created_at: string; is_punch_list: boolean | null }[];
  items: { task_id: string; item_text: string; status: string; sort_order: number; folder_item_id: string | null }[];
};

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The canonical text the fingerprint is taken over: every field the spreadsheet is built from,
 * in a fixed field order, rows sorted by stable keys. Nothing time-of-day dependent is included,
 * so the same data always gives the same text whatever day it is read.
 */
export function canonicalExportText(d: FingerprintInput): string {
  const folders = d.folders.map((f) => [f.id, f.name, f.created_at, !!f.checklist_managed]).sort((a, b) => byKey(String(a[0]), String(b[0])));
  const folderItems = d.folderItems.map((i) => [i.id, i.folder_id, i.item_text, i.sort_order]).sort((a, b) => byKey(String(a[0]), String(b[0])));
  const tasks = d.tasks
    .map((t) => [t.id, t.folder_id ?? null, t.title, t.description ?? null, t.status, t.due_date ?? null, !!t.archived, t.created_at, !!t.is_punch_list])
    .sort((a, b) => byKey(String(a[0]), String(b[0])));
  const items = d.items
    .map((i) => [i.task_id, i.sort_order, i.item_text, i.status, i.folder_item_id ?? null])
    .sort((a, b) => byKey(JSON.stringify(a), JSON.stringify(b)));
  return JSON.stringify({ v: 1, project: [d.project.id, d.project.name, d.project.project_type], folders, folderItems, tasks, items });
}

/** SHA-256 (hex) of canonicalExportText. Uses the platform's Web Crypto (Deno and Node 18+). */
export async function exportFingerprint(d: FingerprintInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalExportText(d));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
