import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDateOnly, isPastDue } from '../lib/dates';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, chip, colors, input, radius, sectionLabel, statusColor } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import AvatarStack from '../components/ui/AvatarStack';
import Icon from '../components/ui/Icon';

const PAGE_SIZE = 50;

// task_assignees is embedded as task_assignees(profile:profiles(full_name)).
function taskAssigneeList(task: any): string[] {
  return (task?.task_assignees ?? []).map((ta: any) => ta.profile?.full_name).filter(Boolean);
}

/** Checklist counts embedded in the same request: { done, total }. */
function checklistProgress(task: any): { done: number; total: number } {
  return { done: task?.ci_done?.[0]?.count ?? 0, total: task?.ci_total?.[0]?.count ?? 0 };
}

/** Characters that would break a PostgREST filter value are dropped from the search text. */
function cleanSearch(text: string): string {
  return text.replace(/[%,()*\\"':]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Done' },
];
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Any priority' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // Wait for typing to pause before asking the database.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cleanSearch(search)), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change goes back to the first page.
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, priorityFilter, projectFilter]);

  const { data: projects } = useQuery({
    queryKey: ['web-tasks-projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').eq('archived', false).order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Exact number of active tasks, for the subtitle (count only, no rows).
  const { data: activeTotal } = useQuery({
    queryKey: ['web-all-tasks', 'active-total'],
    queryFn: async () => {
      const { count, error } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('archived', false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const projectsReady = projects !== undefined;
  const { data: pageData, isLoading, isFetching } = useQuery({
    queryKey: ['web-all-tasks', 'page', page, debouncedSearch, projectFilter, statusFilter, priorityFilter],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(
          '*, task_assignees(profile:profiles(full_name)), project:project_id (name), folder:folder_id (name), ci_total:checklist_items(count), ci_done:checklist_items(count)',
          { count: 'exact' },
        )
        .eq('archived', false)
        .eq('ci_done.status', 'done');
      if (projectFilter !== 'all') query = query.eq('project_id', projectFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (priorityFilter !== 'all') query = query.eq('priority', priorityFilter);
      if (debouncedSearch) {
        // Same fields as before: the task name, or the project name.
        const q = debouncedSearch.toLowerCase();
        const projectIds = (projects ?? []).filter((p: any) => p.name?.toLowerCase().includes(q)).map((p: any) => p.id);
        const parts = [`title.ilike.%${debouncedSearch}%`];
        if (projectIds.length) parts.push(`project_id.in.(${projectIds.join(',')})`);
        query = query.or(parts.join(','));
      }
      const from = (page - 1) * PAGE_SIZE;
      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
    enabled: projectsReady || !debouncedSearch,
    placeholderData: keepPreviousData,
  });

  const { mutate: updateStatus } = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status, archived: status === 'completed' })
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['web-all-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-calendar-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['web-folders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dash-progress'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dash-stats'] });
    },
  });

  const rows = pageData?.rows ?? [];
  const total = pageData?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);
  const filtersActive = !!debouncedSearch || statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all';
  const COLS = 'minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 0.9fr) 96px 84px 92px 128px 92px';

  function clearFilters() {
    setSearch(''); setDebouncedSearch(''); setStatusFilter('all'); setPriorityFilter('all'); setProjectFilter('all');
  }

  const statusControl = (task: any) => (
    <select
      aria-label={`Status of ${task.title}`}
      value={task.status}
      onChange={(e) => updateStatus({ taskId: task.id, status: e.target.value })}
      style={{ ...chip(task.status), border: `1px solid ${statusColor(task.status)}`, padding: '4px 8px', cursor: 'pointer', outline: 'none', maxWidth: '100%' }}
    >
      <option value="open">Open</option>
      <option value="in_progress">In progress</option>
      <option value="completed">Done</option>
    </select>
  );

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Tasks"
        subtitle={activeTotal === undefined ? <Skeleton width={180} height={13} /> : `${activeTotal.toLocaleString()} active task${activeTotal === 1 ? '' : 's'} across all projects`}
      />

      {/* Toolbar */}
      <div style={{ ...card, padding: isMobile ? 12 : 14, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <label htmlFor="task-search" className="fo-sr-only">Search tasks or projects</label>
          <span aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: colors.text3, display: 'inline-flex' }}><Icon name="search" size={15} /></span>
          <input id="task-search" type="search" placeholder="Search tasks or projects..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, paddingLeft: 36, backgroundColor: colors.bg }} />
        </div>
        <label htmlFor="task-project" className="fo-sr-only">Project</label>
        <select id="task-project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ ...input, width: isMobile ? '100%' : 'auto', minWidth: 170, flex: isMobile ? '1 1 100%' : '0 0 auto', cursor: 'pointer', backgroundColor: colors.bg }}>
          <option value="all">All projects</option>
          {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <SegmentedControl label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} fullWidth={isMobile} />
        <SegmentedControl label="Priority" options={PRIORITY_OPTIONS} value={priorityFilter} onChange={setPriorityFilter} fullWidth={isMobile} />
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden', opacity: isFetching && !isLoading ? 0.7 : 1, transition: 'opacity 150ms ease' }} aria-busy={isFetching}>
        {isLoading ? (
          <div role="status" aria-label="Loading tasks">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? `1px solid ${colors.border}` : 'none' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton width="45%" height={14} /><Skeleton width="25%" height={11} /></div>
                <Skeleton width={80} height={22} radius={999} />
                <Skeleton width={90} height={22} radius={999} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20 }}>
            {filtersActive ? (
              <EmptyState title="No tasks match" message="Try a different search or clear the filters." actionLabel="Clear filters" onAction={clearFilters} />
            ) : (
              <EmptyState title="No active tasks" message="Tasks added to your projects show up here." />
            )}
          </div>
        ) : (
          <>
            {!isMobile && (
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, padding: '10px 18px', backgroundColor: colors.bg }}>
                {['Task', 'Project', 'Folder', 'Due', 'Checklist', 'Priority', 'Status', 'Assigned'].map((h) => (
                  <div key={h} style={{ ...sectionLabel, fontSize: 10.5 }}>{h}</div>
                ))}
              </div>
            )}
            {rows.map((task: any) => {
              const isOverdue = isPastDue(task.due_date) && task.status !== 'completed';
              const cl = checklistProgress(task);
              const due = (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, whiteSpace: 'nowrap', color: isOverdue ? colors.red : task.due_date ? colors.text2 : colors.text3, fontWeight: isOverdue ? 700 : 500 }}>
                  {isOverdue && <Icon name="alert" size={13} title="Overdue" />}
                  {task.due_date ? formatDateOnly(task.due_date) : '—'}
                </span>
              );
              const checklist = cl.total > 0 ? (
                <span title={`${cl.done} of ${cl.total} checklist items done`} style={{ fontSize: 13, fontWeight: 600, color: cl.done === cl.total ? colors.green : colors.text2, fontVariantNumeric: 'tabular-nums' }}>{cl.done}/{cl.total}</span>
              ) : <span style={{ fontSize: 13, color: colors.text3 }}>—</span>;
              const projectName = (task.project as any)?.name ?? 'Unknown';
              const folderName = (task.folder as any)?.name ?? '—';
              const title = (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{task.title}</div>
                  {task.description && <div style={{ fontSize: 12, color: colors.text3, marginTop: 2 }}>{task.description.slice(0, 60)}{task.description.length > 60 ? '...' : ''}</div>}
                </div>
              );
              return isMobile ? (
                <div key={task.id} className="fo-row" style={{ padding: '14px 16px', borderTop: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {title}
                  <div style={{ fontSize: 12, color: colors.text2 }}>{projectName}{folderName !== '—' ? ` · ${folderName}` : ''}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {due}
                    {cl.total > 0 && <span style={{ fontSize: 12, color: colors.text3 }}>Checklist {checklist}</span>}
                    <StatusChip status={task.priority} />
                    {statusControl(task)}
                    <AvatarStack names={taskAssigneeList(task)} />
                  </div>
                </div>
              ) : (
                <div key={task.id} className="fo-row" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${colors.border}` }}>
                  {title}
                  <div style={{ fontSize: 13, color: colors.text2, overflowWrap: 'anywhere' }}>{projectName}</div>
                  <div style={{ fontSize: 13, color: colors.text2, overflowWrap: 'anywhere' }}>{folderName}</div>
                  <div>{due}</div>
                  <div>{checklist}</div>
                  <div><StatusChip status={task.priority} /></div>
                  <div>{statusControl(task)}</div>
                  <div><AvatarStack names={taskAssigneeList(task)} /></div>
                </div>
              );
            })}
          </>
        )}

        {/* Paging */}
        {total > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 18px', borderTop: `1px solid ${colors.border}`, backgroundColor: colors.bg }}>
            <span style={{ fontSize: 13, color: colors.text2 }} aria-live="polite">
              Showing {showingFrom.toLocaleString()} to {showingTo.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} {...btn('secondary', { padding: '7px 12px', fontSize: 13 })}>
                <Icon name="chevron-left" size={14} /> Previous
              </button>
              <span style={{ fontSize: 13, color: colors.text3, padding: '0 4px', borderRadius: radius.control }}>Page {page} of {lastPage}</span>
              <button type="button" onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage} {...btn('secondary', { padding: '7px 12px', fontSize: 13 })}>
                Next <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
