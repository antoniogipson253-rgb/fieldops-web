import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useIsAdmin, useCurrentUser } from '../lib/useIsAdmin';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, radius, sectionLabel, statusColor, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Icon from '../components/ui/Icon';

// task_assignees is embedded as task_assignees(profile:profiles(full_name)).
function taskAssigneeNames(task: any): string {
  const names = (task?.task_assignees ?? []).map((ta: any) => ta.profile?.full_name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Unassigned';
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', completed: 'Done' };

// Event chips use the same colors as StatusChip; a task past its due date that is not done shows as Overdue (red).
const LEGEND = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'completed', label: 'Done' },
  { status: 'overdue', label: 'Overdue' },
];

const MAX_CHIPS = 3;

export default function CalendarPage() {
  const isMobile = useIsMobile();
  const { data: isAdmin } = useIsAdmin();
  const { data: currentUser } = useCurrentUser();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['web-calendar-tasks', isAdmin, currentUser?.id],
    queryFn: async () => {
      // Non-admins only see tasks they're an assignee on — resolved via task_assignees
      // now instead of a single assigned_to column. This is the actual visibility
      // control for non-admins on this page, not cosmetic.
      let taskIdsFilter: string[] | null = null;
      if (!isAdmin && currentUser) {
        const { data: myAssignments, error: assignErr } = await supabase
          .from('task_assignees')
          .select('task_id')
          .eq('user_id', currentUser.id);
        if (assignErr) throw assignErr;
        taskIdsFilter = (myAssignments ?? []).map((a: any) => a.task_id);
        if (taskIdsFilter.length === 0) return [];
      }

      let query = supabase
        .from('tasks')
        .select('id, title, due_date, status, priority, project:project_id(name), task_assignees(profile:profiles(full_name))')
        .not('due_date', 'is', null)
        .eq('archived', false);
      if (taskIdsFilter) query = query.in('id', taskIdsFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin !== undefined && !!currentUser,
  });

  /** Status key used for the chip color: completed, overdue, in_progress or open. */
  function getTaskTone(task: any): string {
    const due = new Date(task.due_date);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (task.status === 'completed') return 'completed';
    if (due < now) return 'overdue';
    if (task.status === 'in_progress') return 'in_progress';
    return 'open';
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

  const navButton = { padding: '8px 10px', minWidth: 38 };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader
        title="Calendar"
        subtitle={
          <>
            <span style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 600, letterSpacing: '0.02em', color: colors.text }}>
              {MONTHS[currentMonth]} {currentYear}
            </span>
            <span style={{ display: 'block', fontSize: 13, color: colors.text3, marginTop: 2 }}>
              {isAdmin ? 'All project task due dates' : 'Your assigned task due dates'}
            </span>
          </>
        }
        actions={
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginRight: 4 }} aria-label="Legend">
              {LEGEND.map((l) => <StatusChip key={l.status} status={l.status} label={l.label} />)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} {...btn('secondary', navButton)}>
                <Icon name="chevron-left" size={16} />
              </button>
              <button type="button" onClick={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); setSelectedDate(todayStr); }} {...btn('secondary', { padding: '8px 14px' })}>
                Today
              </button>
              <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} {...btn('secondary', navButton)}>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          </>
        }
      />

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 8 : 12, marginBottom: 20 }}>
        <StatCard label="This month" tone="accent" value={isLoading ? undefined : monthTasks.length} sub="tasks with due dates" />
        <StatCard label="Overdue" tone="gray" alert={overdueTasks.length > 0} value={isLoading ? undefined : overdueTasks.length} sub="past due date" />
        <StatCard label="Total scheduled" tone="blue" value={isLoading ? undefined : (tasks?.length ?? 0)} sub="tasks with due dates" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 300px', gap: 16 }}>
        {/* Calendar */}
        <div style={{ ...card, padding: isMobile ? 8 : 14 }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: isMobile ? 3 : 6, marginBottom: 6 }}>
            {DAYS.map((d) => (
              <div key={d} style={{ ...sectionLabel, fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '4px 0' }}>{d}</div>
            ))}
          </div>

          {/* Grid */}
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: isMobile ? 3 : 6 }} role="status" aria-label="Loading">
              {Array.from({ length: 35 }, (_, i) => <Skeleton key={i} height={74} radius={8} />)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: isMobile ? 3 : 6 }}>
              {cells.map((cell, i) => {
                const cellTasks = getTasksForDate(cell.dateStr);
                const isToday = cell.dateStr === todayStr;
                const isSelected = cell.dateStr === selectedDate;
                const classes = ['fo-cal-day', isToday && 'is-today', isSelected && 'is-selected', cell.isOther && 'is-other'].filter(Boolean).join(' ');

                return (
                  <div
                    key={i}
                    className={classes}
                    onClick={() => setSelectedDate(cell.dateStr === selectedDate ? null : cell.dateStr)}
                    style={isMobile ? { padding: isToday ? 2 : 3 } : undefined}
                  >
                    <div style={{
                      width: 24,
                      height: 24,
                      lineHeight: '24px',
                      borderRadius: 12,
                      textAlign: 'center',
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 600,
                      color: isToday ? colors.onAccent : colors.text,
                      background: isToday ? colors.accent : 'transparent',
                      margin: '0 auto 4px',
                    }}>
                      {cell.day}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {cellTasks.slice(0, MAX_CHIPS).map((t, ti) => {
                        const c = statusColor(getTaskTone(t));
                        return (
                          <div key={ti} title={t.title} style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            lineHeight: 1.35,
                            padding: isMobile ? '1px 3px' : '1px 6px',
                            borderRadius: radius.pill,
                            background: tint(c),
                            color: c,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}>
                            {t.title}
                          </div>
                        );
                      })}
                      {cellTasks.length > MAX_CHIPS && (
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: colors.text3, paddingLeft: isMobile ? 2 : 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          +{cellTasks.length - MAX_CHIPS}{isMobile ? '' : ' more'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={{ ...card, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: 700, letterSpacing: '0.02em' }}>
              {selectedDate
                ? new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
                : 'Select a date'}
            </div>
            {selectedDate && (
              <div style={{ fontSize: 13, color: colors.text3, marginTop: 4 }}>
                {selectedTasks.length === 0 ? 'No tasks due' : `${selectedTasks.length} task${selectedTasks.length !== 1 ? 's' : ''} due`}
              </div>
            )}
          </div>

          <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
            {!selectedDate ? (
              <EmptyState compact title="No date selected" message="Click a day on the calendar to see the tasks due that day." />
            ) : selectedTasks.length === 0 ? (
              <EmptyState
                compact
                title="Nothing due this day"
                message="Pick another day, or jump back to today."
                actionLabel={selectedDate !== todayStr ? 'Go to today' : undefined}
                onAction={() => { setCurrentMonth(today.getMonth()); setCurrentYear(today.getFullYear()); setSelectedDate(todayStr); }}
              />
            ) : (
              selectedTasks.map((task) => {
                const color = statusColor(getTaskTone(task));
                return (
                  <div key={task.id} style={{ background: colors.bg, borderRadius: 10, marginBottom: 10, overflow: 'hidden', border: `1px solid ${colors.border}`, display: 'flex' }}>
                    <div style={{ width: 3, background: color, flexShrink: 0 }} />
                    <div style={{ padding: '12px 14px', flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{task.title}</div>
                      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 10 }}>{(task.project as any)?.name}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <StatusChip status={task.status} label={statusLabels[task.status] ?? task.status} />
                        {getTaskTone(task) === 'overdue' && <StatusChip status="overdue" />}
                        <StatusChip status={task.priority} label={`${task.priority} priority`} />
                        {isAdmin && taskAssigneeNames(task) !== 'Unassigned' && (
                          <span style={{ fontSize: 12, color: colors.text2, background: colors.surface2, padding: '3px 10px', borderRadius: radius.pill }}>
                            {taskAssigneeNames(task)}
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
