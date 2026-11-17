// Per-project spreadsheet: pure builder (ExcelJS is passed in so the same code runs in the
// edge runtime and in offline Node tests) plus the data loader.
//
// Rules (from the brief):
//  - One worksheet per folder (folder order = created_at, as in the app), plus one "Punch List"
//    worksheet for folderless punch items. Sheet names: max 31 chars, no : \ / ? * [ ],
//    unique (case-insensitive, as Excel requires), deduped with " (2)", " (3)", ...
//  - Columns: Task Name, Description, Status, Due Date, then one column per checklist item.
//  - Status text: Open / In Progress / Done (app values open / in_progress / completed).
//  - Due Date: blank, or a real date shown as "Nov 21, 2026".
//  - Checklist cell: "Yes" when the item is Done or Part Received; blank otherwise
//    (Not Started, Missing Part).
//  - Checklist columns only in Tasks + Checklist projects. Folder with a saved folder checklist:
//    its items in its order. Otherwise one column per distinct item name across the folder's
//    tasks, in first-seen order. Punch List: first four columns only.
//  - Archived tasks: included only if completed (shown as Done). Archived and not completed: left
//    out. Deleted tasks simply are not in the data.
//  - Task rows within a sheet: oldest first (created_at), then by name.

export type ExportProject = { id: string; name: string; project_type: string };
export type ExportFolder = { id: string; name: string; created_at: string; checklist_managed: boolean };
export type ExportFolderItem = { id: string; folder_id: string; item_text: string; sort_order: number };
export type ExportTask = {
  id: string; folder_id: string | null; title: string; description: string | null; status: string;
  due_date: string | null; archived: boolean | null; created_at: string; is_punch_list: boolean | null;
};
export type ExportItem = { task_id: string; item_text: string; status: string; sort_order: number; folder_item_id: string | null };
export type ExportData = {
  project: ExportProject; folders: ExportFolder[]; folderItems: ExportFolderItem[]; tasks: ExportTask[]; items: ExportItem[];
};
export type ExportCounts = { open: number; in_progress: number; done: number; total: number };

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done' };
const TICKED = new Set(['done', 'part_received']);
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const BASE_HEADERS = ['Task Name', 'Description', 'Status', 'Due Date'];
const PUNCH_SHEET = 'Punch List';

export function includeTask(t: ExportTask): boolean {
  return !t.archived || t.status === 'completed';
}

// Excel sheet-name rules. Names are compared case-insensitively by Excel.
export function sheetNamer() {
  const used = new Set<string>();
  return (raw: string): string => {
    let base = (raw ?? '').replace(/[:\\/?*\[\]]/g, '-').replace(/[\u0000-\u001f]/g, ' ').trim();
    base = base.replace(/^'+|'+$/g, '').trim();
    if (!base) base = 'Folder';
    if (base.toLowerCase() === 'history') base = 'History (folder)'; // reserved by Excel
    let name = base.slice(0, 31).trim();
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length).trim() + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  };
}

function excelDate(isoDate: string | null): Date | null {
  if (!isoDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function sortTasks(tasks: ExportTask[]): ExportTask[] {
  return [...tasks].sort((a, b) =>
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

type Column = { header: string; folderItemId: string | null };

// Checklist columns for one folder sheet.
export function checklistColumns(data: ExportData, folder: ExportFolder, sheetTasks: ExportTask[], itemsByTask: Map<string, ExportItem[]>): Column[] {
  if (data.project.project_type !== 'checklist') return [];
  if (folder.checklist_managed) {
    return data.folderItems
      .filter((fi) => fi.folder_id === folder.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((fi) => ({ header: fi.item_text, folderItemId: fi.id }));
  }
  const seen = new Set<string>();
  const cols: Column[] = [];
  for (const t of sheetTasks) {
    for (const it of itemsByTask.get(t.id) ?? []) {
      if (!seen.has(it.item_text)) { seen.add(it.item_text); cols.push({ header: it.item_text, folderItemId: null }); }
    }
  }
  return cols;
}

function isTicked(items: ExportItem[], col: Column): boolean {
  const match = col.folderItemId
    ? items.find((i) => i.folder_item_id === col.folderItemId) ?? items.find((i) => i.item_text === col.header)
    : items.find((i) => i.item_text === col.header && TICKED.has(i.status)) ?? items.find((i) => i.item_text === col.header);
  return !!match && TICKED.has(match.status);
}

// deno-lint-ignore no-explicit-any
export function buildWorkbook(ExcelJS: any, data: ExportData): { workbook: any; counts: ExportCounts; sheets: string[] } {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FieldOps Pro';
  wb.created = new Date();

  const included = data.tasks.filter(includeTask);
  const counts: ExportCounts = { open: 0, in_progress: 0, done: 0, total: included.length };
  for (const t of included) {
    if (t.status === 'completed') counts.done++;
    else if (t.status === 'in_progress') counts.in_progress++;
    else counts.open++;
  }

  const itemsByTask = new Map<string, ExportItem[]>();
  for (const it of [...data.items].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!itemsByTask.has(it.task_id)) itemsByTask.set(it.task_id, []);
    itemsByTask.get(it.task_id)!.push(it);
  }

  const nameSheet = sheetNamer();
  const punchTasks = sortTasks(included.filter((t) => !t.folder_id));
  // Reserve the real "Punch List" name first so a folder that happens to be called that gets " (2)".
  const punchName = punchTasks.length > 0 ? nameSheet(PUNCH_SHEET) : null;

  const folders = [...data.folders].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const sheets: string[] = [];

  // deno-lint-ignore no-explicit-any
  const addSheet = (name: string, tasks: ExportTask[], cols: Column[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheets.push(name);
    const longestTitle = Math.max(9, ...tasks.map((t) => t.title.length));
    ws.columns = [
      { header: BASE_HEADERS[0], width: Math.min(45, Math.max(18, longestTitle + 2)) },
      { header: BASE_HEADERS[1], width: 60 },
      { header: BASE_HEADERS[2], width: 13 },
      { header: BASE_HEADERS[3], width: 14 },
      ...cols.map((c) => ({ header: c.header, width: Math.min(24, Math.max(8, c.header.length + 2)) })),
    ];
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'bottom', wrapText: true };

    for (const t of tasks) {
      const items = itemsByTask.get(t.id) ?? [];
      const status = STATUS_LABEL[t.status] ?? t.status;
      const row = ws.addRow([
        t.title,
        t.description || null,          // blank cell, not an empty string
        status,
        excelDate(t.due_date),
        ...cols.map((c) => (isTicked(items, c) ? 'Yes' : null)),
      ]);
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(1).alignment = { vertical: 'top', wrapText: true };
      row.getCell(4).numFmt = 'mmm d, yyyy';
      if (status === 'Done') row.getCell(3).fill = GREEN;
      cols.forEach((_, i) => { const cell = row.getCell(5 + i); if (cell.value === 'Yes') cell.fill = GREEN; });
    }
    return ws;
  };

  for (const f of folders) {
    const fTasks = sortTasks(included.filter((t) => t.folder_id === f.id));
    addSheet(nameSheet(f.name), fTasks, checklistColumns(data, f, fTasks, itemsByTask));
  }
  if (punchName) addSheet(punchName, punchTasks, []);
  if (sheets.length === 0) addSheet(nameSheet('Tasks'), [], []);

  return { workbook: wb, counts, sheets };
}

export function exportFileName(projectName: string, localDate: string): string {
  const safe = (projectName || 'Project').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'Project';
  return `${safe} - Tasks - ${localDate}.xlsx`;
}

// ---------------------------------------------------------------------------
// Data loading (service-role client). Paged: PostgREST returns at most 1000 rows per call.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function pageAll<T>(fetchPage: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// deno-lint-ignore no-explicit-any
export async function loadExportData(admin: any, projectId: string): Promise<ExportData | null> {
  const { data: project, error } = await admin.from('projects').select('id, name, project_type').eq('id', projectId).maybeSingle();
  if (error) throw error;
  if (!project) return null;

  const [folders, tasks] = await Promise.all([
    pageAll<ExportFolder>((a, b) => admin.from('folders').select('id, name, created_at, checklist_managed').eq('project_id', projectId).order('created_at').order('id').range(a, b)),
    pageAll<ExportTask>((a, b) => admin.from('tasks').select('id, folder_id, title, description, status, due_date, archived, created_at, is_punch_list').eq('project_id', projectId).order('created_at').order('id').range(a, b)),
  ]);
  const folderIds = folders.map((f) => f.id);
  const [folderItems, items] = await Promise.all([
    folderIds.length === 0 ? Promise.resolve([] as ExportFolderItem[]) :
      pageAll<ExportFolderItem>((a, b) => admin.from('folder_checklist_items').select('id, folder_id, item_text, sort_order').in('folder_id', folderIds).order('sort_order').order('id').range(a, b)),
    pageAll<ExportItem & { task?: unknown }>((a, b) => admin.from('checklist_items')
      .select('task_id, item_text, status, sort_order, folder_item_id, task:task_id!inner(project_id)')
      .eq('task.project_id', projectId).order('task_id').order('sort_order').order('id').range(a, b)),
  ]);
  return {
    project,
    folders: folders.map((f) => ({ ...f, checklist_managed: !!f.checklist_managed })),
    folderItems,
    tasks,
    items: items.map(({ task: _t, ...rest }) => rest as ExportItem),
  };
}
