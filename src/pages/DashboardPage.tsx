import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser, useUserRole } from '../lib/useIsAdmin';

export default function DashboardPage() {
  const [search, setSearch] = useState('');
  const [groupByEmployee, setGroupByEmployee] = useState(false);
  const { data: isAdmin } = useIsAdmin();
  const { data: currentUser } = useCurrentUser();
  const { data: userRole } = useUserRole();
  const isPM = userRole === 'project_manager';

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [projects, tasks, members] = await Promise.all([
        supabase.from('projects').select('id, status, archived').eq('archived', false),
        supabase.from('tasks').select('id, status, archived').eq('archived', false),
        supabase.from('profiles').select('id'),
      ]);
      const projectData = projects.data ?? [];
      const taskData = tasks.data ?? [];
      const memberData = members.data ?? [];
      return {
        totalProjects: projectData.length,
        activeProjects: projectData.filter((p: any) => p.status === 'active').length,
        totalTasks: taskData.length,
        openTasks: taskData.filter((t: any) => t.status === 'open').length,
        inProgressTasks: taskData.filter((t: any) => t.status === 'in_progress').length,
        completedTasks: taskData.filter((t: any) => t.status === 'completed').length,
        totalMembers: memberData.length,
      };
    },
    enabled: !!isAdmin,
  });

  const { data: pmProjectIds } = useQuery({
    queryKey: ['pm-project-ids', currentUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', currentUser!.id);
      if (error) return [];
      return (data ?? []).map((d: any) => d.project_id);
    },
    enabled: isPM && !!currentUser,
  });

  const { data: allTasks } = useQuery({
    queryKey: ['dashboard-tasks', isAdmin, isPM, currentUser?.id, pmProjectIds],
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from('tasks')
          .select('*, assignee:assigned_to (id, full_name), project:project_id (name)')
          .eq('archived', false)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      } else if (isPM && pmProjectIds && pmProjectIds.length > 0) {
        const { data, error } = await supabase
          .from('tasks')
          .select('*, assignee:assigned_to (id, full_name), project:project_id (name)')
          .eq('archived', false)
          .in('project_id', pmProjectIds)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .select('*, assignee:assigned_to (id, full_name), project:project_id (name)')
          .eq('archived', false)
          .eq('assigned_to', currentUser!.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return data;
      }
    },
    enabled: userRole !== undefined && !!currentUser && (!isPM || pmProjectIds !== undefined),
  });

  const employeeTaskCounts = isAdmin
    ? allTasks?.reduce((acc: Record<string, { name: string; count: number }>, task: any) => {
        if (task.status !== 'open') return acc;
        const assignee = task.assignee as any;
        if (!assignee) return acc;
        if (!acc[assignee.id]) acc[assignee.id] = { name: assignee.full_name ?? 'Unknown', count: 0 };
        acc[assignee.id].count++;
        return acc;
      }, {})
    : {};

  const topEmployee = Object.values(employeeTaskCounts ?? {}).sort((a: any, b: any) => b.count - a.count)[0] as any;

  const filteredTasks = allTasks?.filter((t: any) => {
    if (!search) return true;
    const assigneeName = (t.assignee as any)?.full_name?.toLowerCase() ?? '';
    const taskTitle = t.title?.toLowerCase() ?? '';
    const projectName = (t.project as any)?.name?.toLowerCase() ?? '';
    return (
      assigneeName.includes(search.toLowerCase()) ||
      taskTitle.includes(search.toLowerCase()) ||
      projectName.includes(search.toLowerCase())
    );
  });

  const groupedTasks = filteredTasks?.reduce((acc: Record<string, { name: string; tasks: any[] }>, task: any) => {
    const assignee = task.assignee as any;
    const key = assignee?.id ?? 'unassigned';
    const name = assignee?.full_name ?? 'Unassigned';
    if (!acc[key]) acc[key] = { name, tasks: [] };
    acc[key].tasks.push(task);
    return acc;
  }, {});

  const sortedGroups = Object.entries(groupedTasks ?? {}).sort(([, a], [, b]) =>
    (a as any).name.localeCompare((b as any).name)
  );

  const statCards = [
    { label: 'Active Projects', value: stats?.activeProjects ?? 0, total: stats?.totalProjects ?? 0, color: '#22C55E', icon: '📋' },
    { label: 'Open Tasks', value: stats?.openTasks ?? 0, total: stats?.totalTasks ?? 0, color: '#6B7280', icon: '📌' },
    { label: 'In Progress', value: stats?.inProgressTasks ?? 0, total: stats?.totalTasks ?? 0, color: '#F97316', icon: '⚡' },
    { label: 'Completed', value: stats?.completedTasks ?? 0, total: stats?.totalTasks ?? 0, color: '#3B82F6', icon: '✅' },
    { label: 'Team Members', value: stats?.totalMembers ?? 0, total: null, color: '#8B5CF6', icon: '👥' },
  ];

  const statusColors: Record<string, string> = {
    open: '#6B7280', in_progress: '#F97316', completed: '#22C55E',
  };

  const statusLabels: Record<string, string> = {
    open: 'Open', in_progress: 'In Progress', completed: 'Done',
  };

  const priorityColors: Record<string, string> = {
    low: '#6B7280', medium: '#F59E0B', high: '#EF4444',
  };

  const roleLabel = isAdmin
    ? 'Overview of all projects and tasks'
    : isPM
    ? 'Project Manager - your assigned tasks'
    : 'Your assigned tasks';

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>

      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Dashboard</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>{roleLabel}</p>
      </div>

      {isAdmin && (
        statsLoading ? (
          <div style={{ color: '#F97316', marginBottom: 24 }}>Loading stats...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
            {statCards.map((card) => (
              <div key={card.label} style={{ backgroundColor: '#111827', borderRadius: 14, padding: 20, border: '1px solid #1F2937' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
                <div style={{ fontSize: 32, fontWeight: 900, color: card.color, marginBottom: 4 }}>
                  {card.value}
                  {card.total !== null && (
                    <span style={{ fontSize: 16, color: '#374151', fontWeight: 400 }}>/{card.total}</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600 }}>{card.label}</div>
              </div>
            ))}
            {topEmployee && (
              <div style={{ backgroundColor: '#111827', borderRadius: 14, padding: 20, border: '1px solid #F97316' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🏆</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#F97316', marginBottom: 4 }}>{topEmployee.name}</div>
                <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 600 }}>Most Open Tasks ({topEmployee.count})</div>
              </div>
            )}
          </div>
        )
      )}

      {isPM && !isAdmin && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Assigned to Me', value: allTasks?.length ?? 0, color: '#F97316', icon: '📋' },
            { label: 'Open', value: allTasks?.filter((t: any) => t.status === 'open').length ?? 0, color: '#6B7280', icon: '📌' },
            { label: 'In Progress', value: allTasks?.filter((t: any) => t.status === 'in_progress').length ?? 0, color: '#F97316', icon: '⚡' },
            { label: 'Done', value: allTasks?.filter((t: any) => t.status === 'completed').length ?? 0, color: '#22C55E', icon: '✅' },
          ].map((card) => (
            <div key={card.label} style={{ backgroundColor: '#111827', borderRadius: 12, padding: 16, border: '1px solid #1F2937' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{card.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: card.color, marginBottom: 2 }}>{card.value}</div>
              <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>{card.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={isAdmin ? 'Search by employee, task, or project...' : 'Search tasks...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 240, maxWidth: 400, padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
        />
        {isAdmin && (
          <button
            onClick={() => setGroupByEmployee(!groupByEmployee)}
            style={{
              padding: '10px 16px',
              backgroundColor: groupByEmployee ? '#F97316' : '#111827',
              border: '1px solid',
              borderColor: groupByEmployee ? '#F97316' : '#1F2937',
              borderRadius: 10,
              color: groupByEmployee ? '#0A0F1E' : '#9CA3AF',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Group by Employee
          </button>
        )}
      </div>

      {isAdmin && groupByEmployee ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {sortedGroups.map(([key, group]: [string, any]) => (
            <div key={key} style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', backgroundColor: '#0D1321', borderBottom: '1px solid #1F2937', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#F97316' }}>
                  {group.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{group.name}</span>
                <span style={{ fontSize: 12, color: '#6B7280', backgroundColor: '#1F2937', padding: '2px 8px', borderRadius: 20 }}>
                  {group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {group.tasks.map((task: any, i: number) => (
                    <tr key={task.id} style={{ borderTop: i > 0 ? '1px solid #1F2937' : 'none' }}>
                      <td style={{ padding: '12px 20px' }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{task.title}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{(task.project as any)?.name}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: priorityColors[task.priority], backgroundColor: priorityColors[task.priority] + '20', padding: '3px 8px', borderRadius: 6 }}>
                          {task.priority}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[task.status], backgroundColor: statusColors[task.status] + '20', padding: '3px 8px', borderRadius: 20 }}>
                          {statusLabels[task.status]}
                        </span>
                      </td>
                      {task.due_date && (
                        <td style={{ padding: '12px 16px', fontSize: 12, color: new Date(task.due_date) < new Date() ? '#EF4444' : '#6B7280' }}>
                          {new Date(task.due_date) < new Date() ? '⚠️ ' : '📅 '}
                          {new Date(task.due_date).toLocaleDateString()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {sortedGroups.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#4B5563' }}>No tasks found.</div>
          )}
        </div>
      ) : (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1F2937', fontSize: 13, color: '#6B7280' }}>
            {filteredTasks?.length ?? 0} {isAdmin ? 'tasks total' : isPM ? 'tasks assigned to you' : 'tasks assigned to you'}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#0D1321' }}>
                {['Task', 'Project', ...(isAdmin ? ['Assigned To'] : []), 'Due Date', 'Priority', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredTasks?.map((task: any, i: number) => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
                return (
                  <tr key={task.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132110' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{task.title}</div>
                      {task.description && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                          {task.description.slice(0, 50)}{task.description.length > 50 ? '...' : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{(task.project as any)?.name ?? 'Unknown'}</td>
                    {isAdmin && (
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>{(task.assignee as any)?.full_name ?? 'Unassigned'}</td>
                    )}
                    <td style={{ padding: '12px 16px', fontSize: 12, color: isOverdue ? '#EF4444' : '#9CA3AF', fontWeight: isOverdue ? 700 : 400 }}>
                      {task.due_date ? `${isOverdue ? '⚠️ ' : ''}${new Date(task.due_date).toLocaleDateString()}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: priorityColors[task.priority], backgroundColor: priorityColors[task.priority] + '20', padding: '3px 8px', borderRadius: 6 }}>
                        {task.priority}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: statusColors[task.status], backgroundColor: statusColors[task.status] + '20', padding: '3px 8px', borderRadius: 20 }}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredTasks?.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#4B5563' }}>
              {isAdmin ? 'No tasks found.' : 'No tasks assigned to you yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}