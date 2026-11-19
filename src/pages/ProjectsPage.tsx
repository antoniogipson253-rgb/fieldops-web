import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { localDateKey } from '../lib/dates';
import { btn, card, colors, fonts, input as inputBase, radius, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';

/** Exact count from a count-only request (no rows), so projects past 1,000 tasks count correctly. */
async function countOf(request: PromiseLike<{ count: number | null; error: any }>): Promise<number> {
  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newStatus, setNewStatus] = useState('active');
  const [newProjectType, setNewProjectType] = useState<'regular' | 'checklist'>('regular');
  const [creating, setCreating] = useState(false);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['web-projects', showArchived, isAdmin],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      if (isAdmin) {
        // Admins see all projects
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('archived', showArchived)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      } else {
        // Members only see projects they are on
        const { data, error } = await supabase
          .from('project_members')
          .select('project:project_id (*)')
          .eq('user_id', user.id);
        if (error) throw error;
        return (data ?? [])
          .map((d: any) => d.project)
          .filter((p: any) => p && p.archived === showArchived);
      }
    },
    enabled: isAdmin !== undefined,
  });

  // Read-only task counts for the stat row and each card: progress (completed or archived out of all
  // tasks, the Dashboard's rule), open (active, not done) and overdue. Under 'web-projects' so it
  // refreshes with the list.
  const projectIdsKey = (projects ?? []).map((p: any) => p.id).join(',');
  const { data: taskCounts } = useQuery({
    queryKey: ['web-projects', 'task-counts', projectIdsKey],
    queryFn: async () => {
      const today = localDateKey(new Date());
      const t = () => supabase.from('tasks').select('id', { count: 'exact', head: true });
      const rows = await Promise.all((projects ?? []).map(async (p: any) => {
        const [total, completed, open, overdue] = await Promise.all([
          countOf(t().eq('project_id', p.id)),
          countOf(t().eq('project_id', p.id).or('status.eq.completed,archived.eq.true')),
          countOf(t().eq('project_id', p.id).eq('archived', false).neq('status', 'completed')),
          countOf(t().eq('project_id', p.id).eq('archived', false).neq('status', 'completed').lt('due_date', today)),
        ]);
        return [p.id, { total, completed, open, overdue }] as const;
      }));
      return Object.fromEntries(rows) as Record<string, { total: number; completed: number; open: number; overdue: number }>;
    },
    enabled: !showArchived && (projects?.length ?? 0) > 0,
  });

  const { mutate: archiveProject } = useMutation({
    mutationFn: async ({ projectId, archived }: { projectId: string; archived: boolean }) => {
      const { error } = await supabase
        .from('projects')
        .update({ archived })
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['web-projects'] }),
  });

  const { mutate: deleteProject } = useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['web-projects'] }),
  });

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: project, error } = await supabase
        .from('projects')
        .insert({
          name: newName.trim(),
          description: newDescription.trim() || null,
          status: newStatus,
          project_type: newProjectType,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from('project_members').insert({
        project_id: project.id,
        user_id: user!.id,
        role: 'owner',
      });

      queryClient.invalidateQueries({ queryKey: ['web-projects'] });
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewStatus('active');
      setNewProjectType('regular');
      navigate(`/projects/${project.id}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  }

  const filtered = projects?.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusLabels: Record<string, string> = {
    active: 'Active', completed: 'Completed', on_hold: 'On hold',
  };

  // Totals for the stat row (the projects in view, before search and status filters).
  const activeCount = (projects ?? []).filter((p: any) => p.status === 'active').length;
  const openTotal = (projects ?? []).reduce((s: number, p: any) => s + (taskCounts?.[p.id]?.open ?? 0), 0);
  const overdueTotal = (projects ?? []).reduce((s: number, p: any) => s + (taskCounts?.[p.id]?.overdue ?? 0), 0);
  const countsPending = (projects?.length ?? 0) > 0 && !taskCounts;
  const filtersOn = search.trim() !== '' || statusFilter !== 'all';

  const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: colors.text2, marginBottom: 6 };

  function closeCreate() {
    setShowCreate(false); setNewName(''); setNewDescription(''); setNewProjectType('regular');
  }

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title={showArchived ? 'Archived Projects' : 'Projects'}
        subtitle={`${projects?.length ?? 0} ${showArchived ? 'archived' : isAdmin ? 'total' : 'assigned'} projects`}
        actions={
          <>
            {isAdmin && (
              <button type="button" onClick={() => setShowArchived(!showArchived)} {...btn('secondary')}>
                {showArchived ? <><Icon name="chevron-left" size={14} /> Active projects</> : 'Archived projects'}
              </button>
            )}
            {isAdmin && !showArchived && (
              <button type="button" onClick={() => setShowCreate(true)} {...btn('primary')}>
                <Icon name="plus" size={15} strokeWidth={2.5} /> New project
              </button>
            )}
          </>
        }
      />

      {/* Stats */}
      {!showArchived && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
          <StatCard label="Active projects" tone="accent" value={isLoading ? undefined : activeCount} sub={projects ? `of ${projects.length} ${isAdmin ? 'total' : 'assigned'}` : undefined} />
          <StatCard label="Open tasks" tone="gray" value={isLoading || countsPending ? undefined : openTotal.toLocaleString()} sub="not done yet" />
          <StatCard label="Overdue" tone="red" alert={overdueTotal > 0} value={isLoading || countsPending ? undefined : overdueTotal.toLocaleString()} sub="past due date" />
        </div>
      )}

      {/* Filters */}
      {!showArchived && (
        <div style={{ ...card, padding: isMobile ? 12 : 14, display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: isMobile ? 'none' : 360, minWidth: 0 }}>
            <span aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.text3, display: 'inline-flex' }}>
              <Icon name="search" size={15} />
            </span>
            <label htmlFor="project-search" className="fo-sr-only">Search projects</label>
            <input
              id="project-search"
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputBase, paddingLeft: 36, backgroundColor: colors.bg }}
            />
          </div>
          <SegmentedControl
            label="Project status"
            options={['all', 'active', 'on_hold', 'completed'].map((s) => ({ value: s, label: s === 'all' ? 'All' : statusLabels[s] }))}
            value={statusFilter}
            onChange={setStatusFilter}
            fullWidth={isMobile}
          />
        </div>
      )}

      {/* Projects grid */}
      {isLoading ? (
        <div role="status" aria-label="Loading projects" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={196} radius={12} />)}
        </div>
      ) : (filtered?.length ?? 0) === 0 ? (
        showArchived ? (
          <EmptyState title="No archived projects" message="Archived projects will appear here." />
        ) : filtersOn && (projects?.length ?? 0) > 0 ? (
          <EmptyState title="No projects match" message="No projects match this search and status." actionLabel="Clear filters" onAction={() => { setSearch(''); setStatusFilter('all'); }} />
        ) : (
          <EmptyState
            title="No projects found"
            message={isAdmin ? 'Create your first project to get started.' : 'You have not been added to any projects yet.'}
            actionLabel={isAdmin ? 'New project' : undefined}
            onAction={isAdmin ? () => setShowCreate(true) : undefined}
          />
        )
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
          {filtered?.map((project) => {
            const counts = taskCounts?.[project.id];
            const pct = counts && counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
            const hasOverdue = !!counts && counts.overdue > 0;
            return (
              <div key={project.id} className={showArchived ? 'fo-card' : 'fo-card fo-card-link'} style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div
                  onClick={() => !showArchived && navigate(`/projects/${project.id}`)}
                  style={{ padding: '18px 20px 16px', cursor: showArchived ? 'default' : 'pointer', flex: 1, minWidth: 0 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                    <h3 style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: 700, lineHeight: 1.1, letterSpacing: '0.01em', textTransform: 'uppercase', margin: 0, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {project.name}
                    </h3>
                    <StatusChip status={showArchived ? 'archived' : project.status} label={showArchived ? 'Archived' : statusLabels[project.status]} />
                  </div>
                  {project.description && (
                    <p style={{ fontSize: 13, color: colors.text2, margin: '0 0 12px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{project.description}</p>
                  )}

                  {!showArchived && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                        <div role="progressbar" aria-label={`${project.name} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ flex: 1, height: 6, background: colors.track, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: colors.accent, borderRadius: 3, transition: 'width 0.4s ease' }} />
                        </div>
                        <span style={{ fontFamily: fonts.display, fontSize: 18, fontWeight: 700, minWidth: 42, textAlign: 'right' }}>{counts ? `${pct}%` : '–'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: colors.text2, flexWrap: 'wrap' }}>
                        <span>
                          <strong style={{ fontFamily: fonts.display, fontSize: 17, color: colors.text }}>{counts ? counts.open.toLocaleString() : '–'}</strong> open
                        </span>
                        <span style={{ color: hasOverdue ? colors.red : colors.text2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {hasOverdue && <Icon name="alert" size={13} />}
                          <strong style={{ fontFamily: fonts.display, fontSize: 17, color: hasOverdue ? colors.red : colors.text }}>{counts ? counts.overdue.toLocaleString() : '–'}</strong> overdue
                        </span>
                      </div>
                    </>
                  )}

                  <div style={{ fontSize: 12, color: colors.text3, marginTop: 12 }}>
                    Created {new Date(project.created_at).toLocaleDateString()}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${colors.border}`, padding: '12px 20px', flexWrap: 'wrap' }}>
                  {showArchived ? (
                    isAdmin ? (
                      <>
                        <button type="button" onClick={() => archiveProject({ projectId: project.id, archived: false })} {...btn('secondary', { flex: 1, padding: '8px 12px', fontSize: 13 })}>Restore</button>
                        <button type="button" onClick={() => { if (window.confirm(`Permanently delete "${project.name}"?`)) deleteProject(project.id); }} {...btn('danger', { flex: 1, padding: '8px 12px', fontSize: 13 })}>
                          <Icon name="trash" size={14} /> Delete
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: colors.text3, padding: '8px 0' }}>Archived, contact an admin to restore</span>
                    )
                  ) : (
                    <>
                      <button type="button" onClick={() => navigate(`/projects/${project.id}`)} {...btn('secondary', { flex: 1, padding: '8px 12px', fontSize: 13 })}>
                        Open <Icon name="arrow-right" size={14} />
                      </button>
                      {isAdmin && (
                        <button type="button" onClick={() => { if (window.confirm(`Archive "${project.name}"?`)) archiveProject({ projectId: project.id, archived: true }); }} {...btn('ghost', { padding: '8px 12px', fontSize: 13 })}>
                          Archive
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create project modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="create-project-title" style={{ ...card, padding: isMobile ? 20 : 28, width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 id="create-project-title" style={{ margin: '0 0 20px', fontFamily: fonts.display, fontSize: 26, fontWeight: 700, letterSpacing: '0.02em' }}>New project</h3>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="new-project-name" style={fieldLabel}>Project name *</label>
              <input id="new-project-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. MD Anderson Building A" autoFocus style={inputBase} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="new-project-description" style={fieldLabel}>Description (optional)</label>
              <textarea id="new-project-description" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Brief description of the project..." style={{ ...inputBase, resize: 'vertical', minHeight: 80 }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="new-project-status" style={fieldLabel}>Status</label>
              <select id="new-project-status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)} style={{ ...inputBase, width: 'auto', minWidth: 180, cursor: 'pointer' }}>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div style={{ marginBottom: 24 }}>
              <p style={fieldLabel}>Project type</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {([
                  { key: 'regular' as const, icon: 'clipboard' as const, title: 'Regular project', sub: 'Standard tasks and folders' },
                  { key: 'checklist' as const, icon: 'check' as const, title: 'Tasks + Checklist', sub: 'Tasks carry a parts checklist' },
                ]).map((t) => {
                  const on = newProjectType === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setNewProjectType(t.key)}
                      style={{ padding: 14, borderRadius: radius.card, cursor: 'pointer', textAlign: 'left', minWidth: 0, color: colors.text, backgroundColor: on ? tint(colors.accent, 0.12) : colors.surface2, border: `1px solid ${on ? colors.accent : colors.border}` }}
                    >
                      <span style={{ display: 'inline-flex', color: on ? colors.accent : colors.text2, marginBottom: 8 }}><Icon name={t.icon} size={20} strokeWidth={2} /></span>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{t.title}</div>
                      <div style={{ fontSize: 12, color: colors.text2 }}>{t.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={closeCreate} {...btn('secondary', { flex: 1 })}>Cancel</button>
              <button type="button" onClick={handleCreate} disabled={creating || !newName.trim()} {...btn('primary', { flex: 2 })}>
                {creating ? 'Creating...' : 'Create project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
