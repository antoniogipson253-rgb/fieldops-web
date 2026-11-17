import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

// "Edit folder checklist" (Tasks + Checklist projects; company admins and project managers).
// Every task in the folder shares this checklist. Saving runs save_folder_checklist, one atomic
// database function: first as a dry run, whose exact counts are shown for confirmation, then for
// real. Adding an item adds it (not done) to every task; renaming renames it everywhere;
// deleting removes it and its ticks from every task; the order is the spreadsheet column order.
// Tasks with their own different checklist are overwritten, keeping ticks where an item name
// matches exactly.

const MAX_ITEMS = 45;
const MAX_LEN = 200;

type Folder = { id: string; name: string; checklist_managed?: boolean };
type Row = { key: string; id: string | null; text: string };
type Counts = {
  tasks_in_folder: number; tasks_touched: number; ticked_items_lost: number; missing_part_items_lost: number;
  items_total: number; items_added: number; items_renamed: number; items_deleted: number; first_save: boolean;
};

let keySeq = 0;
const newKey = () => `row-${++keySeq}`;

function describeError(e: any): string {
  switch (e?.code) {
    case 'FCL01': return 'Only company admins and project managers can edit a folder checklist.';
    case 'FCL03': return 'Folder checklists are only available in Tasks + Checklist projects.';
    case 'FCL04': return `A folder checklist can have at most ${MAX_ITEMS} items.`;
    case 'FCL02': return e?.message ?? 'Some items are not valid.';
    default: return e?.message ?? 'Something went wrong.';
  }
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 };
const box: React.CSSProperties = { backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 14, padding: 24, width: '100%', maxWidth: 620, maxHeight: '90vh', overflowY: 'auto', color: '#FFFFFF' };
const input: React.CSSProperties = { flex: 1, padding: '8px 12px', backgroundColor: '#0A0F1E', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 13, minWidth: 0 };
const smallBtn: React.CSSProperties = { padding: '6px 10px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 6, color: '#9CA3AF', fontSize: 12, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '10px 18px', backgroundColor: '#F97316', border: 'none', borderRadius: 10, color: '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '10px 18px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 10, color: '#9CA3AF', fontSize: 14, cursor: 'pointer' };

export function FolderChecklistEditor({ folder, onClose, onSaved }: { folder: Folder; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Counts | null>(null);
  const [done, setDone] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let texts: { id: string | null; text: string }[] = [];
        if (folder.checklist_managed) {
          const { data, error } = await supabase.from('folder_checklist_items')
            .select('id, item_text, sort_order').eq('folder_id', folder.id).order('sort_order');
          if (error) throw error;
          texts = (data ?? []).map((r: any) => ({ id: r.id, text: r.item_text }));
        } else {
          // No folder checklist saved yet: start from the items the folder's tasks already use,
          // in first-seen order (the same columns the spreadsheet shows for this folder).
          const { data: tasks, error: tErr } = await supabase.from('tasks')
            .select('id, created_at, title').eq('folder_id', folder.id).order('created_at').order('title');
          if (tErr) throw tErr;
          const ids = (tasks ?? []).map((t: any) => t.id);
          const items: any[] = [];
          for (let i = 0; i < ids.length; i += 150) {
            const { data, error } = await supabase.from('checklist_items')
              .select('task_id, item_text, sort_order').in('task_id', ids.slice(i, i + 150));
            if (error) throw error;
            items.push(...(data ?? []));
          }
          const order = new Map(ids.map((id: string, i: number) => [id, i]));
          items.sort((a, b) => (order.get(a.task_id)! - order.get(b.task_id)!) || a.sort_order - b.sort_order);
          const seen = new Set<string>();
          for (const it of items) if (!seen.has(it.item_text)) { seen.add(it.item_text); texts.push({ id: null, text: it.item_text }); }
          texts = texts.slice(0, MAX_ITEMS);
        }
        if (!cancelled) setRows(texts.map((t) => ({ key: newKey(), id: t.id, text: t.text })));
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? 'Could not load the checklist.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [folder.id, folder.checklist_managed]);

  const problems = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const t = r.text.trim();
      if (!t) out.push(`Item ${i + 1} is empty.`);
      else if (t.length > MAX_LEN) out.push(`Item ${i + 1} is longer than ${MAX_LEN} characters.`);
      else if (seen.has(t)) out.push(`"${t}" appears more than once.`);
      seen.add(t);
    });
    if (rows.length > MAX_ITEMS) out.push(`At most ${MAX_ITEMS} items.`);
    return out;
  }, [rows]);

  const payload = () => rows.map((r) => ({ id: r.id, text: r.text.trim() }));

  function addItem() {
    const t = draft.trim();
    if (!t || rows.length >= MAX_ITEMS) return;
    setRows([...rows, { key: newKey(), id: null, text: t }]);
    setDraft('');
    setPreview(null);
  }
  const update = (key: string, text: string) => { setRows(rows.map((r) => (r.key === key ? { ...r, text } : r))); setPreview(null); };
  const remove = (key: string) => { setRows(rows.filter((r) => r.key !== key)); setPreview(null); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; setRows(next); setPreview(null);
  };

  async function review() {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.rpc('save_folder_checklist', { p_folder_id: folder.id, p_items: payload(), p_dry_run: true });
      if (error) throw error;
      setPreview(data as Counts);
    } catch (e: any) { setError(describeError(e)); }
    finally { setBusy(false); }
  }

  async function confirmSave() {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.rpc('save_folder_checklist', { p_folder_id: folder.id, p_items: payload(), p_dry_run: false });
      if (error) throw error;
      setDone(data as Counts);
      onSaved();
    } catch (e: any) { setError(describeError(e)); setPreview(null); }
    finally { setBusy(false); }
  }

  return (
    <div style={overlay} onClick={() => !busy && onClose()}>
      <div style={box} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Edit folder checklist for ${folder.name}`}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 800 }}>Edit folder checklist</h3>
        <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>
          Folder: <strong style={{ color: '#FFFFFF' }}>{folder.name}</strong>. Every task in this folder shares this checklist, and new tasks get it automatically. The order here is the column order in the spreadsheet.
        </div>

        {loading ? (
          <div style={{ color: '#F97316', fontSize: 13 }}>Loading...</div>
        ) : loadError ? (
          <div role="alert" style={{ color: '#FCA5A5', fontSize: 13 }}>{loadError}</div>
        ) : done ? (
          <div>
            <div role="status" style={{ padding: 14, backgroundColor: '#14532D30', border: '1px solid #22C55E60', borderRadius: 10, fontSize: 13, color: '#BBF7D0', marginBottom: 16 }}>
              Saved. {done.tasks_touched} of {done.tasks_in_folder} tasks updated
              {done.ticked_items_lost > 0 ? `, ${done.ticked_items_lost} ticked item${done.ticked_items_lost === 1 ? '' : 's'} removed` : ''}.
            </div>
            <button onClick={onClose} style={primaryBtn}>Close</button>
          </div>
        ) : (
          <>
            {!folder.checklist_managed && (
              <div style={{ padding: 12, backgroundColor: '#1F293780', border: '1px solid #374151', borderRadius: 10, fontSize: 12, color: '#D1D5DB', marginBottom: 14 }}>
                This folder does not have a shared checklist yet. The list below starts from the items its tasks already use. When you save, tasks with a different checklist are changed to match it. Ticks are kept where an item name matches exactly.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {rows.length === 0 && <div style={{ fontSize: 13, color: '#6B7280' }}>No items. Saving an empty list removes every checklist item from the tasks in this folder.</div>}
              {rows.map((r, i) => (
                <div key={r.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 22, fontSize: 12, color: '#6B7280', textAlign: 'right' }}>{i + 1}</span>
                  <input value={r.text} onChange={(e) => update(r.key, e.target.value)} maxLength={MAX_LEN} aria-label={`Item ${i + 1}`} style={input} />
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={{ ...smallBtn, opacity: i === 0 ? 0.4 : 1 }}>Up</button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" style={{ ...smallBtn, opacity: i === rows.length - 1 ? 0.4 : 1 }}>Down</button>
                  <button onClick={() => remove(r.key)} aria-label={`Remove item ${i + 1}`} style={{ ...smallBtn, color: '#EF4444', borderColor: '#EF444460' }}>Remove</button>
                </div>
              ))}
            </div>

            {rows.length >= MAX_ITEMS ? (
              <div style={{ fontSize: 12, color: '#F59E0B', marginBottom: 12 }}>Limit reached: {MAX_ITEMS} items per folder checklist.</div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} maxLength={MAX_LEN} placeholder="Add an item..." aria-label="New item" style={input} />
                <button onClick={addItem} disabled={!draft.trim()} style={{ ...smallBtn, color: '#F97316', borderColor: '#F97316', opacity: draft.trim() ? 1 : 0.5 }}>Add</button>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>{rows.length} of {MAX_ITEMS} items</div>

            {problems.length > 0 && <div role="alert" style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 12 }}>{problems[0]}</div>}
            {error && <div role="alert" style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 12 }}>{error}</div>}

            {preview ? (
              <div role="alertdialog" aria-label="Confirm folder checklist changes" style={{ padding: 14, backgroundColor: '#7F1D1D20', border: '1px solid #EF444460', borderRadius: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Confirm changes</div>
                <ul style={{ margin: '0 0 10px 18px', padding: 0, fontSize: 13, color: '#E5E7EB', lineHeight: 1.6 }}>
                  <li>{preview.tasks_touched} of {preview.tasks_in_folder} task{preview.tasks_in_folder === 1 ? '' : 's'} in this folder will be changed.</li>
                  <li>{preview.ticked_items_lost} ticked item{preview.ticked_items_lost === 1 ? '' : 's'} will be lost.</li>
                  {preview.missing_part_items_lost > 0 && <li>{preview.missing_part_items_lost} Missing Part flag{preview.missing_part_items_lost === 1 ? '' : 's'} will be removed.</li>}
                  {preview.items_deleted > 0 && <li>{preview.items_deleted} item{preview.items_deleted === 1 ? '' : 's'} will be removed from every task in this folder.</li>}
                  {preview.items_added > 0 && <li>{preview.items_added} item{preview.items_added === 1 ? '' : 's'} will be added to every task, not done.</li>}
                  {preview.items_renamed > 0 && <li>{preview.items_renamed} item{preview.items_renamed === 1 ? '' : 's'} will be renamed on every task.</li>}
                  {preview.first_save && <li>Tasks with their own different checklist will be changed to match this folder.</li>}
                </ul>
                <div style={{ fontSize: 13, color: '#FCA5A5', marginBottom: 12 }}>This cannot be undone.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => setPreview(null)} disabled={busy} style={ghostBtn}>Go back</button>
                  <button onClick={confirmSave} disabled={busy} style={{ ...primaryBtn, backgroundColor: '#EF4444', color: '#FFFFFF' }}>
                    {busy ? 'Saving...' : `Save and update ${preview.tasks_touched} task${preview.tasks_touched === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={onClose} disabled={busy} style={ghostBtn}>Cancel</button>
                <button onClick={review} disabled={busy || problems.length > 0} style={{ ...primaryBtn, opacity: busy || problems.length > 0 ? 0.5 : 1 }}>
                  {busy ? 'Checking...' : 'Save'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
