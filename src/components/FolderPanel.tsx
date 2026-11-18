import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Icon from './ui/Icon';

export type PanelFolder = { id: string; name: string; task_count: number };

type Group = { key: string; label: string; folders: PanelFolder[]; total: number };

const OTHER = '__other__';
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Leading letters of the name, up to the first non-letter (hyphen, space, digit, slash...). */
function leadingLetters(name: string): string {
  const m = name.trim().match(/^[A-Za-z]+/);
  return m ? m[0] : '';
}

/**
 * Groups folders by the leading letters of their name (AHU-D1.1 -> AHU). A group is only made when the
 * key is 2-6 letters, all uppercase, and at least 2 folders share it; everything else goes to "Other folders".
 */
export function groupFolders(folders: PanelFolder[]): Group[] {
  const byKey = new Map<string, PanelFolder[]>();
  for (const f of folders) {
    const k = leadingLetters(f.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(f);
  }
  const groups: Group[] = [];
  const other: PanelFolder[] = [];
  byKey.forEach((list, k) => {
    if (list.length >= 2 && /^[A-Z]{2,6}$/.test(k)) groups.push({ key: k, label: k, folders: list, total: 0 });
    else other.push(...list);
  });
  groups.sort((a, b) => collator.compare(a.label, b.label));
  if (other.length > 0) groups.push({ key: OTHER, label: 'Other folders', folders: other, total: 0 });
  for (const g of groups) {
    g.folders.sort((a, b) => collator.compare(a.name, b.name));
    g.total = g.folders.reduce((s, f) => s + (f.task_count ?? 0), 0);
  }
  return groups;
}

type Props = {
  folders: PanelFolder[];
  /** Exact number of tasks in the project, for the "All tasks" row. */
  allCount: number;
  selectedId: string | null;
  onSelect: (folderId: string | null) => void;
  /** Rendered at the bottom of the list, e.g. "+ New folder". */
  footer?: ReactNode;
  loading?: boolean;
};

export default function FolderPanel({ folders, allCount, selectedId, onSelect, footer, loading }: Props) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupFolders(folders), [folders]);
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => g.folders.forEach((f) => m.set(f.id, g.key)));
    return m;
  }, [groups]);

  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // The group holding the selected folder starts (and stays) open; a lone group starts open too.
  useEffect(() => {
    setOpen((prev) => {
      const next = new Set(prev);
      const k = selectedId ? groupOf.get(selectedId) : undefined;
      if (k) next.add(k);
      if (groups.length === 1) next.add(groups[0].key);
      return next.size === prev.size ? prev : next;
    });
  }, [selectedId, groupOf, groups]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, folders: g.folders.filter((f) => f.name.toLowerCase().includes(q)) }))
      .filter((g) => g.folders.length > 0);
  }, [groups, q]);

  // Typing expands every group that has matches.
  useEffect(() => {
    if (!q) return;
    setOpen((prev) => {
      const next = new Set(prev);
      visible.forEach((g) => next.add(g.key));
      return next;
    });
  }, [q, visible]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="fo-folder-panel">
      <label htmlFor={searchId} className="fo-sr-only">Search folders</label>
      <input
        id={searchId}
        type="search"
        className="fo-folder-search"
        placeholder={`Search ${folders.length} folder${folders.length === 1 ? '' : 's'}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      <button
        type="button"
        className={`fo-folder-row${selectedId === null ? ' is-active' : ''}`}
        aria-current={selectedId === null ? 'true' : undefined}
        onClick={() => onSelect(null)}
      >
        <span className="fo-folder-name">All tasks</span>
        <span className="fo-folder-count">{allCount}</span>
      </button>

      {loading ? (
        <div className="fo-folder-hint" role="status">Loading folders…</div>
      ) : visible.length === 0 ? (
        <div className="fo-folder-hint">{q ? 'No folders match.' : 'No folders yet.'}</div>
      ) : (
        visible.map((g) => {
          const isOpen = open.has(g.key);
          const listId = `${searchId}-g-${g.key}`;
          return (
            <div key={g.key} className="fo-folder-group">
              <button
                type="button"
                className="fo-folder-group-header"
                aria-expanded={isOpen}
                aria-controls={listId}
                onClick={() => toggle(g.key)}
              >
                <span className={`fo-chevron${isOpen ? ' is-open' : ''}`}><Icon name="chevron-right" size={13} strokeWidth={2.75} /></span>
                <span className="fo-folder-group-label">{g.label}</span>
                <span className="fo-folder-count">{g.total}</span>
              </button>
              {isOpen && (
                <div id={listId} className="fo-folder-group-list">
                  {g.folders.map((f) => {
                    const active = selectedId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`fo-folder-row${active ? ' is-active' : ''}${f.task_count === 0 ? ' is-empty' : ''}`}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => onSelect(f.id)}
                        title={f.name}
                      >
                        <span className="fo-folder-name">{f.name}</span>
                        <span className="fo-folder-count">{f.task_count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      {footer && <div className="fo-folder-footer">{footer}</div>}
    </div>
  );
}
