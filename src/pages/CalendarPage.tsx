import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser } from '../lib/useIsAdmin';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done' };

const priorityStyle: Record<string, React.CSSProperties> = {
  high: { background: '#FCEBEB', color: '#A32D2D', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  medium: { background: '#FAEEDA', color: '#854F0B', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  low: { background: '#EAF3DE', color: '#3B6D11', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
};

const statusStyle: Record<string, React.CSSProperties> = {
  open: { background: '#1F2937', color: '#9CA3AF', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  in_progress: { background: '#E6F1FB', color: '#185FA5', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
  completed: { background: '#EAF3DE', color: '#3B6D11', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 600 },
};

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
        .select('id, title, due_date, status, priority, assigned_to, project:project_id(name), assignee:assigned_to(full_name)')
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
    if (task.status === 'completed') return '#1D9E75';
    if (due < now) return '#E24B4A';
    const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
    if (diff <= 3) return '#EF9F27';
    if (task.status === 'in_progress') return '#378ADD';
    return '#EF9F27';
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

  // Build cells — week starts Monday
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const mondayOffset = (firstDayOfMonth + 6) % 7;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedTasks = selectedDate ? getTasksForDate(selectedDate) : [];

  const cells: { dateStr: string; day: number; isOther: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    if (i < mondayOffset) {
      const day = prevMonthDays - mondayOffset + i + 1;
      const pm = currentMonth - 1 < 0 ? 11 : currentMonth - 1;
      const py = currentMonth - 1 < 0 ? currentYear - 1 : currentYear;
      cells.push({ dateStr: formatDateStr(py, pm, day), day, isOther: true });
    } else if (i >= mondayOffset + daysInMonth) {
      const day = i - mondayOffset - daysInMonth + 1;
      const nm = currentMonth + 1 > 11 ? 0 : currentMonth + 1;
      const ny = currentMonth + 1 > 11 ? currentYear + 1 : currentYear;
      cells.push({ dateStr: formatDateStr(ny, nm, day), day, isOther: true });
    } else {
      const day = i - mondayOffset + 1;
      cells.push({ dateStr: formatDateStr(currentYear, currentMonth, day), day, isOther: false });
    }
  }

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
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>Calendar</h1>
        <p style={{ color: '#6B7280', fontSize: 13, margin: 0 }}>
          {isAdmin ? 'All project task due dates' : 'Your assigned task due dates'}
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderLeft: '3px solid #378ADD', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>This month</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{monthTasks.length}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>tasks with due dates</p>
        </div>
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderLeft: '3px solid #E24B4A', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Overdue</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: overdueTasks.length > 0 ? '#EF4444' : '#FFFFFF' }}>{overdueTasks.length}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>past due date</p>
        </div>
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderLeft: '3px solid #EF9F27', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>Total scheduled</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{tasks?.length ?? 0}</p>
          <p style={{ fontSize: 11, color: '#4B5563', margin: '3px 0 0' }}>tasks with due dates</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
        {/* Calendar */}
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderRadius: 14, overflow: 'hidden' }}>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '0.5px solid #1F2937' }}>
            <button onClick={() => changeMonth(-1)} style={{ background: '#1F2937', border: '0.5px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', padding: '6px 14px', lineHeight: 1 }}>‹</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{MONTHS[currentMonth]} {currentYear}</span>
              <button onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); setSelectedDate(todayStr); }} style={{ background: 'transparent', border: '0.5px solid #374151', borderRadius: 6, color: '#9CA3AF', fontSize: 12, cursor: 'pointer', padding: '4px 10px' }}>
                Today
              </button>
            </div>
            <button onClick={() => changeMonth(1)} style={{ background: '#1F2937', border: '0.5px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 16, cursor: 'pointer', padding: '6px 14px', lineHeight: 1 }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '10px 10px 0', gap: 2 }}>
            {DAYS.map((d) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#4B5563', padding: '4px 0', letterSpacing: 1 }}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          {isLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#F97316', fontSize: 13 }}>Loading...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '4px 10px 10px', gap: 2 }}>
              {cells.map((cell, i) => {
                const cellTasks = getTasksForDate(cell.dateStr);
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDate;
                const isWeekend = i % 7 >= 5;

                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDate(cell.dateStr === selectedDate ? null : cell.dateStr)}
                    style={{
                      minHeight: 72,
                      padding: '6px 4px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: isSelected ? '#1F2937' : isToday ? '#F9731610' : 'transparent',
                      border: isToday ? '1px solid #F97316' : '1px solid transparent',
                      opacity: cell.isOther ? 0.3 : 1,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#1F293750'; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = isToday ? '#F9731610' : 'transparent'; }}
                  >
                    <div style={{
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 400,
                      color: isToday ? '#F97316' : isWeekend ? '#6B7280' : '#FFFFFF',
                      textAlign: 'center',
                      marginBottom: 4,
                      width: 22,
                      height: 22,
                      lineHeight: '22px',
                      borderRadius: 11,
                      background: isToday ? '#F9731620' : 'transparent',
                      margin: '0 auto 4px',
                    }}>
                      {cell.day}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {cellTasks.slice(0, 2).map((t, ti) => (
                        <div key={ti} style={{
                          fontSize: 9,
                          padding: '2px 4px',
                          borderRadius: 3,
                          background: getTaskColor(t) + '25',
                          color: getTaskColor(t),
                          fontWeight: 600,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          borderLeft: `2px solid ${getTaskColor(t)}`,
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
          <div style={{ display: 'flex', gap: 20, padding: '12px 20px', borderTop: '0.5px solid #1F2937', flexWrap: 'wrap' }}>
            {[
              { color: '#EF9F27', label: 'Due soon' },
              { color: '#E24B4A', label: 'Overdue' },
              { color: '#378ADD', label: 'In progress' },
              { color: '#1D9E75', label: 'Completed' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: item.color }} />
                <span style={{ fontSize: 11, color: '#6B7280' }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel */}
        <div style={{ background: '#111827', border: '0.5px solid #1F2937', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '0.5px solid #1F2937' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {selectedDate
                ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                : 'Select a date'}
            </div>
            {selectedDate && (
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                {selectedTasks.length === 0 ? 'No tasks due' : `${selectedTasks.length} task${selectedTasks.length !== 1 ? 's' : ''} due`}
              </div>
            )}
          </div>

          <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
            {!selectedDate ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4B5563' }}>
                <div style={{ fontSize: 13 }}>Click a date to see tasks due</div>
              </div>
            ) : selectedTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#4B5563' }}>
                <div style={{ fontSize: 13 }}>No tasks due this day</div>
              </div>
            ) : (
              selectedTasks.map((task) => {
                const color = getTaskColor(task);
                return (
                  <div key={task.id} style={{ background: '#0D1321', borderRadius: 10, marginBottom: 10, overflow: 'hidden', border: '0.5px solid #1F2937', display: 'flex' }}>
                    <div style={{ width: 3, background: color, flexShrink: 0 }} />
                    <div style={{ padding: '12px 14px', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{task.title}</div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 10 }}>{(task.project as any)?.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={statusStyle[task.status] ?? statusStyle.open}>{statusLabels[task.status] ?? task.status}</span>
                        <span style={priorityStyle[task.priority] ?? priorityStyle.low}>{task.priority}</span>
                        {isAdmin && (task.assignee as any)?.full_name && (
                          <span style={{ fontSize: 11, color: '#6B7280', background: '#1F2937', padding: '2px 8px', borderRadius: 6 }}>
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