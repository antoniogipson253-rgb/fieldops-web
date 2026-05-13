import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser } from '../lib/useIsAdmin';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CalendarPage() {
  const { data: isAdmin } = useIsAdmin();
  const { data: currentUser } = useCurrentUser();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['web-calendar-tasks', isAdmin, currentUser?.id],
    queryFn: async () => {
      let query = supabase
        .from('tasks')
        .select(`id, title, due_date, status, priority, assigned_to, project:project_id (name), assignee:assigned_to (full_name)`)
        .not('due_date', 'is', null)
        .eq('archived', false);

      if (!isAdmin && currentUser) {
        query = query.eq('assigned_to', currentUser.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin !== undefined && !!currentUser,
  });

  function getTaskColor(task: any) {
    const due = new Date(task.due_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (task.status === 'completed') return '#22C55E';
    if (due < now) return '#EF4444';
    const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    if (diff <= 3) return '#F97316';
    if (task.status === 'in_progress') return '#3B82F6';
    return '#F97316';
  }

  function formatDateStr(y: number, m: number, d: number) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function getTasksForDate(dateStr: string) {
    return tasks?.filter((t) => t.due_date?.slice(0, 10) === dateStr) ?? [];
  }

  function changeMonth(dir: number) {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCurrentMonth(m);
    setCurrentYear(y);
    setSelectedDate(null);
  }

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedTasks = selectedDate ? getTasksForDate(selectedDate) : [];

  const cells: { dateStr: string; day: number; isOther: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    if (i < firstDay) {
      const day = prevMonthDays - firstDay + i + 1;
      const pm = currentMonth - 1 < 0 ? 11 : currentMonth - 1;
      const py = currentMonth - 1 < 0 ? currentYear - 1 : currentYear;
      cells.push({ dateStr: formatDateStr(py, pm, day), day, isOther: true });
    } else if (i >= firstDay + daysInMonth) {
      const day = i - firstDay - daysInMonth + 1;
      const nm = currentMonth + 1 > 11 ? 0 : currentMonth + 1;
      const ny = currentMonth + 1 > 11 ? currentYear + 1 : currentYear;
      cells.push({ dateStr: formatDateStr(ny, nm, day), day, isOther: true });
    } else {
      const day = i - firstDay + 1;
      cells.push({ dateStr: formatDateStr(currentYear, currentMonth, day), day, isOther: false });
    }
  }

  const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done' };
  const priorityColors: Record<string, string> = { low: '#6B7280', medium: '#F59E0B', high: '#EF4444' };

  // Count tasks with due dates this month
  const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const monthTasks = tasks?.filter((t) => t.due_date?.startsWith(monthStr)) ?? [];
  const overdueTasks = tasks?.filter((t) => {
    const due = new Date(t.due_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return due < now && t.status !== 'completed';
  }) ?? [];

  return (
    <div style={{ padding: 32, color: '#FFFFFF' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Calendar</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
          {isAdmin ? 'All project due dates' : 'Your assigned task due dates'}
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'This Month', value: monthTasks.length, color: '#3B82F6', icon: '📅' },
          { label: 'Overdue', value: overdueTasks.length, color: '#EF4444', icon: '⚠️' },
          { label: 'Total w/ Due Date', value: tasks?.length ?? 0, color: '#F97316', icon: '📋' },
        ].map((stat) => (
          <div key={stat.label} style={{ backgroundColor: '#111827', borderRadius: 12, padding: 16, border: '1px solid #1F2937' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{stat.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
        {/* Calendar */}
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          {/* Month Nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #1F2937' }}>
            <button onClick={() => changeMonth(-1)} style={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 18, cursor: 'pointer', padding: '4px 12px', lineHeight: 1 }}>‹</button>
            <button onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); setSelectedDate(todayStr); }} style={{ backgroundColor: 'transparent', border: 'none', color: '#FFFFFF', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>
              {MONTHS[currentMonth]} {currentYear}
            </button>
            <button onClick={() => changeMonth(1)} style={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 18, cursor: 'pointer', padding: '4px 12px', lineHeight: 1 }}>›</button>
          </div>

          {/* Day Labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 8px 0' }}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#4B5563', padding: '6px 0', letterSpacing: 1 }}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          {isLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#F97316' }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '0 8px 8px', gap: 2 }}>
              {cells.map((cell, i) => {
                const cellTasks = getTasksForDate(cell.dateStr);
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDate;

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDate(cell.dateStr === selectedDate ? null : cell.dateStr)}
                    style={{
                      minHeight: 70, padding: 6, borderRadius: 8, cursor: 'pointer',
                      backgroundColor: isSelected ? '#1F2937' : isToday ? '#F9731610' : 'transparent',
                      border: isToday ? '1px solid #F97316' : '1px solid transparent',
                      opacity: cell.isOther ? 0.35 : 1,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#1F293780'; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = isToday ? '#F9731610' : 'transparent'; }}
                  >
                    <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? '#F97316' : '#FFFFFF', marginBottom: 4 }}>
                      {cell.day}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {cellTasks.slice(0, 2).map((t, ti) => (
                        <div key={ti} style={{
                          fontSize: 9, padding: '1px 4px', borderRadius: 4,
                          backgroundColor: getTaskColor(t) + '30',
                          color: getTaskColor(t),
                          fontWeight: 700, overflow: 'hidden',
                          whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                        }}>
                          {t.title}
                        </div>
                      ))}
                      {cellTasks.length > 2 && (
                        <div style={{ fontSize: 9, color: '#6B7280', paddingLeft: 4 }}>+{cellTasks.length - 2} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 20px', borderTop: '1px solid #1F2937', flexWrap: 'wrap' }}>
            {[
              { color: '#F97316', label: 'Due soon' },
              { color: '#EF4444', label: 'Overdue' },
              { color: '#3B82F6', label: 'In progress' },
              { color: '#22C55E', label: 'Completed' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
                <span style={{ fontSize: 11, color: '#6B7280' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side Panel */}
        <div style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1F2937' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {selectedDate
                ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                : 'Select a date'}
            </div>
            {selectedDate && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{selectedTasks.length} task{selectedTasks.length !== 1 ? 's' : ''} due</div>}
          </div>

          <div style={{ padding: 16, maxHeight: 600, overflowY: 'auto' }}>
            {!selectedDate ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4B5563' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
                <div style={{ fontSize: 13 }}>Click a date to see tasks due</div>
              </div>
            ) : selectedTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4B5563' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 13 }}>No tasks due this day</div>
              </div>
            ) : (
              selectedTasks.map((task) => {
                const color = getTaskColor(task);
                return (
                  <div key={task.id} style={{ backgroundColor: '#0D1321', borderRadius: 10, marginBottom: 10, overflow: 'hidden', border: '1px solid #1F2937', display: 'flex' }}>
                    <div style={{ width: 4, backgroundColor: color, flexShrink: 0 }} />
                    <div style={{ padding: 12, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#FFFFFF', marginBottom: 4 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8 }}>{(task.project as any)?.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color, backgroundColor: color + '20', padding: '2px 6px', borderRadius: 4 }}>
                          {statusLabels[task.status]}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: priorityColors[task.priority], backgroundColor: priorityColors[task.priority] + '20', padding: '2px 6px', borderRadius: 4 }}>
                          {task.priority}
                        </span>
                        {isAdmin && (task.assignee as any)?.full_name && (
                          <span style={{ fontSize: 10, color: '#6B7280', backgroundColor: '#1F2937', padding: '2px 6px', borderRadius: 4 }}>
                            {(task.assignee as any).full_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}