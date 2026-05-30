import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['web-all-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(`*, assignee:assigned_to (full_name), project:project_id (name)`)
        .eq('archived', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
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

  const filtered = tasks?.filter((t) => {
    const matchesSearch =
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.project as any)?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const statusColors: Record<string, string> = {
    open: '#6B7280', in_progress: '#F97316', completed: '#22C55E',
  };

  const priorityColors: Record<string, string> = {
    low: '#6B7280', medium: '#F59E0B', high: '#EF4444',
  };

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Tasks</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>All tasks across all projects</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search tasks or projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, maxWidth: 320, padding: '10px 16px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 10, color: '#FFFFFF', fontSize: 14, outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'open', 'in_progress', 'completed'].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '10px 14px', backgroundColor: statusFilter === s ? '#F97316' : '#111827', border: '1px solid', borderColor: statusFilter === s ? '#F97316' : '#1F2937', borderRadius: 10, color: statusFilter === s ? '#0A0F1E' : '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {s === 'all' ? 'All Status' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'high', 'medium', 'low'].map((p) => (
            <button key={p} onClick={() => setPriorityFilter(p)} style={{ padding: '10px 14px', backgroundColor: priorityFilter === p ? '#F97316' : '#111827', border: '1px solid', borderColor: priorityFilter === p ? '#F97316' : '#1F2937', borderRadius: 10, color: priorityFilter === p ? '#0A0F1E' : '#9CA3AF', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {p === 'all' ? 'All Priority' : p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ color: '#F97316' }}>Loading...</div>
      ) : (
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1F2937', fontSize: 13, color: '#6B7280' }}>
            {filtered?.length ?? 0} tasks
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#0D1321' }}>
                {['Task', 'Project', 'Due Date', 'Priority', 'Status', 'Assigned To'].map((h) => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered?.map((task, i) => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
                return (
                  <tr key={task.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132110' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{task.title}</div>
                      {task.description && <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{task.description.slice(0, 60)}{task.description.length > 60 ? '...' : ''}</div>}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>
                      {(task.project as any)?.name ?? 'Unknown'}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: isOverdue ? '#EF4444' : '#9CA3AF', fontWeight: isOverdue ? 700 : 400 }}>
                      {task.due_date ? `${isOverdue ? '⚠️ ' : ''}${new Date(task.due_date).toLocaleDateString()}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: priorityColors[task.priority], backgroundColor: priorityColors[task.priority] + '20', padding: '3px 8px', borderRadius: 6 }}>
                        {task.priority}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <select
                        value={task.status}
                        onChange={(e) => updateStatus({ taskId: task.id, status: e.target.value })}
                        style={{ backgroundColor: statusColors[task.status] + '20', border: `1px solid ${statusColors[task.status]}`, borderRadius: 20, color: statusColors[task.status], padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
                      >
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Done</option>
                      </select>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#9CA3AF' }}>
                      {(task.assignee as any)?.full_name ?? 'Unassigned'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered?.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#4B5563' }}>No tasks found.</div>
          )}
        </div>
      )}
    </div>
  );
}