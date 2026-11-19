import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDateOnly, isPastDue } from '../lib/dates';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, chip, colors, fonts, input as inputBase, radius, sectionLabel, statusColor, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useUserRole } from '../lib/useIsAdmin';

// task_assignees is embedded as task_assignees(profile:profiles(id, full_name)).
function taskAssigneeProfiles(item: any): { id: string; full_name: string }[] {
  return (item?.task_assignees ?? []).map((ta: any) => ta.profile).filter(Boolean);
}
function taskAssigneeNames(item: any): string {
  const names = taskAssigneeProfiles(item).map((p) => p.full_name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Unassigned';
}


export default function PunchListPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { data: isAdmin } = useIsAdmin();
  const { data: userRole } = useUserRole();
  const canCreate = isAdmin || userRole === 'project_manager';

  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium',
    assigneeIds: [] as string[], due_date: '', photo_url: '',
  });
  const [creating, setCreating] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemStatus, setItemStatus] = useState<'all' | 'open' | 'in_progress' | 'completed'>('all');

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['punch-list-projects'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      if (isAdmin) {
        const { data } = await supabase.from('projects').select('id, name, status').eq('archived', false).order('name');
        return data ?? [];
      } else {
        const { data } = await supabase.from('project_members').select('project:project_id(id, name, status)').eq('user_id', user.id);
        return (data ?? []).map((d: any) => d.project).filter((p: any) => p && !p.archived);
      }
    },
    enabled: isAdmin !== undefined,
  });
const { data: punchItems, isLoading: itemsLoading } = useQuery({
    queryKey: ['punch-list-items', selectedProject?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, task_assignees(user_id, profile:profiles(id, full_name))')
        .eq('project_id', selectedProject.id)
        .eq('is_punch_list', true)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedProject,
  });

  const { data: teamMembers } = useQuery({
    queryKey: ['punch-list-members', selectedProject?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('project_members')
        .select('user:user_id(id, full_name)')
        .eq('project_id', selectedProject.id);
      return (data ?? []).map((d: any) => d.user).filter(Boolean);
    },
    enabled: !!selectedProject,
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['punch-list-items', selectedProject?.id] });
    },
  });

  async function handlePhotoUpload(file: File): Promise<string | null> {
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `punch-list/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('task-photos').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('task-photos').getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      return null;
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleCreate() {
    if (!form.title.trim() || !selectedProject) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let photoUrl = form.photo_url;
      if (photoFile) {
        const uploaded = await handlePhotoUpload(photoFile);
        if (uploaded) photoUrl = uploaded;
      }
      const { data: newTask, error } = await supabase.from('tasks').insert({
        project_id: selectedProject.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        due_date: form.due_date || null,
        status: 'open',
        created_by: user!.id,
        is_punch_list: true,
        punch_list_photo: photoUrl || null,
      }).select('id').single();
      if (error) throw error;

      if (form.assigneeIds.length > 0) {
        const { error: assignErr } = await supabase.from('task_assignees').insert(
          form.assigneeIds.map((user_id) => ({ task_id: newTask.id, user_id }))
        );
        if (assignErr) throw assignErr;
      }

      queryClient.invalidateQueries({ queryKey: ['punch-list-items', selectedProject.id] });
      setShowCreate(false);
      setForm({ title: '', description: '', priority: 'medium', assigneeIds: [], due_date: '', photo_url: '' });
      setPhotoFile(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  }

  const openCount = punchItems?.filter((t) => t.status === 'open').length ?? 0;
  const inProgressCount = punchItems?.filter((t) => t.status === 'in_progress').length ?? 0;
  const doneCount = punchItems?.filter((t) => t.status === 'completed').length ?? 0;
  const overdueCount = punchItems?.filter((t) => t.status !== 'completed' && isPastDue(t.due_date)).length ?? 0;

  // Filters only narrow the list already loaded; they do not change what is read.
  const q = itemSearch.trim().toLowerCase();
  const visibleItems = (punchItems ?? []).filter((t: any) =>
    (itemStatus === 'all' || t.status === itemStatus) &&
    (!q || (t.title ?? '').toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)));
  const filtersOn = q !== '' || itemStatus !== 'all';

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };
  const resetForm = () => { setShowCreate(false); setForm({ title: '', description: '', priority: 'medium', assigneeIds: [], due_date: '', photo_url: '' }); setPhotoFile(null); };
  const gridCols = 'minmax(0, 2.4fr) 96px 112px minmax(0, 1fr) 150px';

  function statusSelect(item: any, fullWidth = false) {
    const c = statusColor(item.status);
    return (
      <select
        aria-label={`Status for ${item.title}`}
        value={item.status}
        onChange={(e) => updateStatus({ id: item.id, status: e.target.value })}
        style={{ ...chip(item.status), padding: '5px 10px', border: `1px solid ${tint(c, 0.5)}`, cursor: 'pointer', outline: 'none', width: fullWidth ? '100%' : 'auto', minHeight: 32 }}
      >
        <option value="open">Open</option>
        <option value="in_progress">In Progress</option>
        <option value="completed">Done</option>
      </select>
    );
  }

  function dueText(item: any) {
    if (!item.due_date) return <span style={{ color: colors.text3 }}>No due date</span>;
    const late = item.status !== 'completed' && isPastDue(item.due_date);
    return (
      <span style={{ color: late ? colors.red : colors.text2, fontWeight: late ? 700 : 500, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        {late && <Icon name="alert" size={13} />}
        {formatDateOnly(item.due_date, { month: 'short', day: 'numeric' })}
      </span>
    );
  }

  function photo(item: any, size: { w: number; h: number }) {
    if (!item.punch_list_photo) return null;
    return (
      <img
        src={item.punch_list_photo}
        alt="Punch list"
        style={{ width: size.w, height: size.h, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', border: `1px solid ${colors.border}`, flexShrink: 0 }}
        onClick={() => window.open(item.punch_list_photo, '_blank')}
      />
    );
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Punch List"
        breadcrumb={selectedProject ? [{ label: 'Punch List', onClick: () => setSelectedProject(null) }, { label: selectedProject.name }] : undefined}
        subtitle={selectedProject
          ? `${selectedProject.name}: ${(punchItems ?? []).length} item${(punchItems ?? []).length === 1 ? '' : 's'}`
          : 'Select a project to view or manage punch list items'}
        actions={selectedProject ? (
          <>
            <button type="button" onClick={() => setSelectedProject(null)} {...btn('secondary')}>
              <Icon name="chevron-left" size={14} /> All projects
            </button>
            {canCreate && (
              <button type="button" onClick={() => setShowCreate(true)} {...btn('primary')}>
                <Icon name="plus" size={15} strokeWidth={2.5} /> Add item
              </button>
            )}
          </>
        ) : undefined}
      />

      {/* Project selector */}
      {!selectedProject ? (
        <div>
          <p style={{ ...sectionLabel, marginBottom: 12 }}>Select project</p>
          {projectsLoading ? (
            <div role="status" aria-label="Loading projects" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} height={78} radius={12} />)}
            </div>
          ) : (projects ?? []).length === 0 ? (
            <EmptyState title="No projects found" message="Projects you're on will appear here." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
              {(projects ?? []).map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  className="fo-card fo-card-link"
                  onClick={() => setSelectedProject(p)}
                  style={{ ...card, padding: '16px 18px', textAlign: 'left', color: colors.text, font: 'inherit', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minWidth: 0 }}
                >
                  <span style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.01em', lineHeight: 1.1, minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</span>
                  <StatusChip status={p.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* Counts */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard label="Open" tone="gray" value={itemsLoading ? undefined : openCount} />
            <StatCard label="In progress" tone="blue" value={itemsLoading ? undefined : inProgressCount} />
            <StatCard label="Completed" tone="green" value={itemsLoading ? undefined : doneCount} />
            <StatCard label="Overdue" tone="red" alert={overdueCount > 0} value={itemsLoading ? undefined : overdueCount} sub="past due, not done" />
          </div>

          {/* Filters */}
          <div style={{ ...card, padding: isMobile ? 12 : 14, display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: isMobile ? 'none' : 340, minWidth: 0 }}>
              <span aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.text3, display: 'inline-flex' }}>
                <Icon name="search" size={15} />
              </span>
              <label htmlFor="punch-search" className="fo-sr-only">Search punch list</label>
              <input id="punch-search" type="text" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Search items..." style={{ ...inputBase, paddingLeft: 36, backgroundColor: colors.bg }} />
            </div>
            <SegmentedControl
              label="Status"
              options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Done' }]}
              value={itemStatus}
              onChange={setItemStatus}
              fullWidth={isMobile}
            />
          </div>

          {/* Items */}
          {itemsLoading ? (
            <div role="status" aria-label="Loading punch list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={64} radius={10} />)}
            </div>
          ) : (punchItems ?? []).length === 0 ? (
            <EmptyState
              title="No punch list items yet"
              message={canCreate ? 'Add the first item for this project.' : 'No punch list items have been added yet.'}
              actionLabel={canCreate ? 'Add item' : undefined}
              onAction={canCreate ? () => setShowCreate(true) : undefined}
            />
          ) : visibleItems.length === 0 ? (
            <EmptyState title="No items match" message={filtersOn ? 'No punch list items match this search and status.' : ''} actionLabel="Clear filters" onAction={() => { setItemSearch(''); setItemStatus('all'); }} />
          ) : isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleItems.map((item: any) => (
                <div key={item.id} style={{ ...card, padding: 14, borderLeft: `4px solid ${statusColor(item.priority)}`, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{item.title}</div>
                      {item.description && <p style={{ fontSize: 13, color: colors.text2, margin: '4px 0 0', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{item.description}</p>}
                    </div>
                    {photo(item, { w: 64, h: 48 })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 13 }}>
                    <StatusChip status={item.priority} />
                    {dueText(item)}
                    <span style={{ color: colors.text2, minWidth: 0, overflowWrap: 'anywhere' }}>{taskAssigneeNames(item)}</span>
                  </div>
                  <div style={{ marginTop: 10 }}>{statusSelect(item, true)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '10px 18px', borderBottom: `1px solid ${colors.border}`, backgroundColor: colors.bg }}>
                {['Item', 'Priority', 'Due', 'Assigned', 'Status'].map((h) => <span key={h} style={{ ...sectionLabel, fontSize: 10.5 }}>{h}</span>)}
              </div>
              {visibleItems.map((item: any, i: number) => (
                <div key={item.id} className="fo-row" style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, alignItems: 'center', padding: '12px 18px', borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`, boxShadow: `inset 4px 0 0 ${statusColor(item.priority)}` }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                    {photo(item, { w: 56, h: 42 })}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 12.5, color: colors.text2, marginTop: 2, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{item.description}</div>}
                    </div>
                  </div>
                  <span><StatusChip status={item.priority} /></span>
                  <span style={{ fontSize: 13 }}>{dueText(item)}</span>
                  <span style={{ fontSize: 13, color: taskAssigneeNames(item) === 'Unassigned' ? colors.text3 : colors.text2, minWidth: 0, overflowWrap: 'anywhere' }}>{taskAssigneeNames(item)}</span>
                  <span>{statusSelect(item)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="punch-create-title" style={{ ...card, padding: isMobile ? 20 : 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 id="punch-create-title" style={{ margin: '0 0 4px', fontFamily: fonts.display, fontSize: 26, fontWeight: 700, letterSpacing: '0.02em' }}>Add punch list item</h3>
            <p style={{ color: colors.text2, fontSize: 13, margin: '0 0 20px' }}>{selectedProject?.name}</p>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="punch-title" style={fieldLabel}>Item title *</label>
              <input id="punch-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Fix cracked drywall in Room 4" autoFocus style={inputBase} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="punch-description" style={fieldLabel}>Description (optional)</label>
              <textarea id="punch-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Additional details..." style={{ ...inputBase, resize: 'vertical', minHeight: 72 }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
              <div style={{ minWidth: 0 }}>
                <label htmlFor="punch-priority" style={fieldLabel}>Priority</label>
                <select id="punch-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ ...inputBase, cursor: 'pointer' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div style={{ minWidth: 0 }}>
                <label htmlFor="punch-due" style={fieldLabel}>Due date</label>
                <input id="punch-due" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} style={{ ...inputBase, colorScheme: 'dark' }} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={fieldLabel}>Assign to</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(teamMembers ?? []).map((m: any) => {
                  const selected = form.assigneeIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setForm({ ...form, assigneeIds: selected ? form.assigneeIds.filter((x) => x !== m.id) : [...form.assigneeIds, m.id] })}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: radius.pill, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: selected ? tint(colors.accent, 0.15) : colors.surface2, border: `1px solid ${selected ? colors.accent : colors.border}`, color: selected ? colors.accent : colors.text2 }}
                    >
                      {selected && <Icon name="check" size={13} strokeWidth={3} />}{m.full_name}
                    </button>
                  );
                })}
                {(!teamMembers || teamMembers.length === 0) && <span style={{ fontSize: 13, color: colors.text3 }}>No team members on this project yet.</span>}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="punch-photo" style={fieldLabel}>Photo (optional)</label>
              <input
                id="punch-photo"
                type="file"
                accept="image/*"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                style={{ ...inputBase, padding: '8px 14px', cursor: 'pointer' }}
              />
              {photoFile && <p style={{ fontSize: 12, color: colors.green, marginTop: 6 }}>Selected: {photoFile.name}</p>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={resetForm} {...btn('secondary', { flex: 1 })}>
                Cancel
              </button>
              <button type="button" onClick={handleCreate} disabled={creating || uploadingPhoto || !form.title.trim()} {...btn('primary', { flex: 2 })}>
                {creating ? 'Creating...' : uploadingPhoto ? 'Uploading photo...' : 'Add to punch list'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
