import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, radius, sectionLabel, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import StatusChip from '../components/ui/StatusChip';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';

function getWeekRange(weekOffset: number) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function minutesToHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

// Postgres `timestamp without time zone` columns come back from PostgREST with no
// 'Z'/offset suffix, which makes `new Date()` misparse a UTC instant as local time
// (e.g. clock_in stored as UTC 12:43 gets read back as local 12:43 instead of converting
// to 7:43 AM CDT). Force UTC interpretation when no timezone marker is present.
function toInstant(timestamp: string): Date {
  // Postgres can emit a 2-digit-only UTC offset (e.g. "+00") when minutes are zero —
  // the minutes group must be optional or a valid offset like "+00" gets missed,
  // causing a spurious 'Z' to be appended and corrupting an already-correct timestamp.
  const hasTzMarker = /Z$|[+-]\d{2}(:?\d{2})?$/.test(timestamp);
  return new Date(hasTzMarker ? timestamp : `${timestamp}Z`);
}

function formatTime(dateStr: string) {
  return toInstant(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function formatDate(dateStr: string) {
  return toInstant(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

export default function TimesheetPage() {
  const [weekOffset, setWeekOffset] = useState(-1);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const { start, end } = getWeekRange(weekOffset);
  const weekLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const { data: companyData } = useQuery({
    queryKey: ['web-timesheet-company'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from('company_members')
        .select('company:company_id (id, name)')
        .eq('user_id', user.id)
        .single();
      return (data as any)?.company ?? null;
    },
  });

  const { data: entries, isLoading } = useQuery({
    queryKey: ['web-timesheet', weekOffset, companyData?.id],
    queryFn: async () => {
      if (!companyData?.id) return [];

      const { data, error } = await supabase
        .from('time_entries')
        .select('*, project:project_id (name, lunch_break_minutes)')
        .eq('company_id', companyData.id)
        .gte('clock_in', start.toISOString())
        .lte('clock_in', end.toISOString())
        .order('clock_in', { ascending: true });

      if (error) throw error;

      const userIds = [...new Set((data ?? []).map((e: any) => e.user_id))];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const profileMap: Record<string, string> = {};
      for (const p of profiles ?? []) {
        profileMap[p.id] = p.full_name ?? 'Unknown';
      }

      return (data ?? []).map((e: any) => ({
        ...e,
        profile: { id: e.user_id, full_name: profileMap[e.user_id] ?? 'Unknown' },
      }));
    },
    enabled: !!companyData?.id,
  });

  const { data: payrollSettings } = useQuery({
    queryKey: ['web-payroll-settings'],
    queryFn: async () => {
      if (!companyData?.id) return null;
      const { data } = await supabase
        .from('payroll_settings')
        .select('recipient_email')
        .eq('company_id', companyData.id)
        .single();
      return data;
    },
    enabled: !!companyData?.id,
  });

  const byEmployee: Record<string, { name: string; entries: any[]; totalMinutes: number }> = {};
  for (const entry of entries ?? []) {
    const name = (entry as any).profile?.full_name ?? 'Unknown';
    const userId = entry.user_id;
    if (!byEmployee[userId]) {
      byEmployee[userId] = { name, entries: [], totalMinutes: 0 };
    }
    byEmployee[userId].entries.push(entry);
    byEmployee[userId].totalMinutes += (entry as any).total_minutes ?? 0;
  }

  const totalHours = Object.values(byEmployee).reduce((sum, e) => sum + e.totalMinutes, 0);

  const flaggedEntries = (entries ?? []).filter((e: any) => e.flagged || !e.clock_out);

  async function handleSendReport() {
    if (!companyData?.id || !payrollSettings?.recipient_email) {
      setSendResult({ success: false, message: 'No recipient email set. Go to Payroll settings first.' });
      return;
    }
    setSending(true);
    setSendResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/send-payroll-report`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify({ recipientEmail: payrollSettings.recipient_email, companyId: companyData.id, weekOffset }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send');
      setSendResult({ success: true, message: `Report sent to ${payrollSettings.recipient_email}` });
    } catch (e: any) {
      setSendResult({ success: false, message: e.message });
    } finally {
      setSending(false);
    }
  }

  const weekName = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${Math.abs(weekOffset)} weeks ago`;
  const WEEK_OPTIONS = [
    { value: 0, label: 'This week' },
    { value: -1, label: 'Last week' },
    { value: -2, label: '2 weeks ago' },
    { value: -3, label: '3 weeks ago' },
  ];
  const th: React.CSSProperties = { ...sectionLabel, fontSize: 10.5, padding: '9px 14px', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, color: colors.text2, whiteSpace: 'nowrap' };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text, maxWidth: 1100 }}>
      <PageHeader
        title="Timesheet Viewer"
        subtitle="Review hours worked by your team for any week"
        actions={
          <button onClick={handleSendReport} disabled={sending} {...btn('secondary')}>
            <Icon name="mail" size={15} /> {sending ? 'Sending...' : 'Email report'}
          </button>
        }
      />

      {/* Week selector */}
      <div style={{ ...card, padding: isMobile ? 12 : 14, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="fo-icon-btn" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
          <Icon name="chevron-left" size={16} />
        </button>
        <SegmentedControl
          label="Week"
          options={WEEK_OPTIONS}
          value={weekOffset}
          onChange={(v) => setWeekOffset(v)}
        />
        <button type="button" className="fo-icon-btn" aria-label="Next week" onClick={() => setWeekOffset((w) => Math.min(w + 1, 0))} disabled={weekOffset >= 0} style={{ opacity: weekOffset >= 0 ? 0.4 : 1 }}>
          <Icon name="chevron-right" size={16} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginLeft: isMobile ? 0 : 6 }}>
          {weekName} <span style={{ color: colors.text2, fontWeight: 500 }}>· {weekLabel}</span>
        </span>
      </div>

      {sendResult && (
        <div role={sendResult.success ? 'status' : 'alert'} style={{ marginBottom: 16, padding: '11px 16px', borderRadius: radius.control, display: 'flex', alignItems: 'center', gap: 8, backgroundColor: tint(sendResult.success ? colors.green : colors.red, 0.12), border: `1px solid ${tint(sendResult.success ? colors.green : colors.red, 0.5)}`, color: sendResult.success ? colors.green : colors.red, fontSize: 14, fontWeight: 600 }}>
          <Icon name={sendResult.success ? 'check' : 'alert'} size={15} strokeWidth={sendResult.success ? 3 : 2.25} />
          {sendResult.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 8 : 12, marginBottom: 16 }}>
        <StatCard label="Total hours" tone="accent" value={isLoading ? undefined : `${minutesToHours(totalHours)}h`} />
        <StatCard label="Employees" tone="blue" value={isLoading ? undefined : Object.keys(byEmployee).length} />
        <StatCard label="Clock-ins" tone="green" value={isLoading ? undefined : entries?.length ?? 0} />
      </div>

      {flaggedEntries.length > 0 && (
        <div style={{ backgroundColor: colors.redSurface, border: `1px solid ${tint(colors.red, 0.5)}`, borderRadius: radius.card, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: colors.red, marginBottom: 10 }}>
            <Icon name="alert" size={16} /> {flaggedEntries.length} flagged entr{flaggedEntries.length === 1 ? 'y' : 'ies'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flaggedEntries.map((e: any) => {
              const isMissing = !e.clock_out;
              const name = (e as any).profile?.full_name ?? 'Unknown';
              const reason = isMissing ? 'Missing clock-out' : (e.flag_reason || 'Flagged');
              return (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 12px', backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderRadius: radius.control }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{name}</span>
                  <span style={{ fontSize: 13, color: colors.text2 }}>{formatDate(e.clock_in)}</span>
                  <StatusChip status={isMissing ? 'medium' : 'high'} label={reason} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Loading timesheet" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={72} radius={12} />)}
        </div>
      ) : Object.keys(byEmployee).length === 0 ? (
        <EmptyState
          title="No time entries"
          message="No one clocked in during this week."
          actionLabel={weekOffset !== 0 ? 'Go to this week' : undefined}
          onAction={() => setWeekOffset(0)}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(byEmployee).map(([userId, employee]) => {
            const isExpanded = expandedEmployee === userId;
            const regularHours = Math.min(minutesToHours(employee.totalMinutes), 40);
            const overtimeHours = Math.max(0, minutesToHours(employee.totalMinutes) - 40);
            return (
              <div key={userId} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <button
                  type="button"
                  className="fo-row"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedEmployee(isExpanded ? null : userId)}
                  style={{ width: '100%', padding: isMobile ? '14px 14px' : '14px 20px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: colors.text, font: 'inherit' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 19, flexShrink: 0, backgroundColor: colors.surface2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: colors.text }}>
                      {employee.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div style={{ textAlign: 'left', minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: 'anywhere' }}>{employee.name}</div>
                      <div style={{ fontSize: 13, color: colors.text2, marginTop: 2 }}>
                        {employee.entries.length} shift{employee.entries.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{minutesToHours(employee.totalMinutes)}h</div>
                      {overtimeHours > 0 && (
                        <div style={{ fontSize: 12, color: colors.red, fontWeight: 700, marginTop: 2 }}>+{overtimeHours}h OT</div>
                      )}
                    </div>
                    <span aria-hidden="true" style={{ color: colors.text2, display: 'inline-flex', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
                      <Icon name="chevron-down" size={18} />
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div style={{ borderTop: `1px solid ${colors.border}`, overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead>
                        <tr style={{ backgroundColor: colors.bg }}>
                          {['Date', 'Clock in', 'Clock out', 'Raw hrs', 'Lunch', 'Net hrs', 'OT', 'Flag', 'Project', 'Notes'].map((h) => (
                            <th key={h} style={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {employee.entries.map((entry: any) => {
                          const lunchBreakMinutes = (entry.project as any)?.lunch_break_minutes ?? 0;
                          const rawMinutes = entry.total_minutes ?? 0;
                          const lunchMinutes = rawMinutes > 0 && lunchBreakMinutes > 0 ? lunchBreakMinutes : 0;
                          const netMinutes = Math.max(0, rawMinutes - lunchMinutes);
                          const rawHours = (rawMinutes / 60).toFixed(2);
                          const lunchDeduction = lunchMinutes > 0 ? `-${(lunchMinutes / 60).toFixed(2)}` : '—';
                          const netHours = (netMinutes / 60).toFixed(2);
                          const isOT = netMinutes > 8 * 60;
                          const isMissingClockOut = !entry.clock_out;
                          const flagReason = isMissingClockOut ? 'Missing clock-out' : (entry.flagged ? (entry.flag_reason || 'Flagged') : '');
                          return (
                            <tr key={entry.id} className="fo-row" style={{ borderTop: `1px solid ${colors.border}` }}>
                              <td style={{ ...td, color: colors.text }}>{formatDate(entry.clock_in)}</td>
                              <td style={td}>{formatTime(entry.clock_in)}</td>
                              <td style={{ ...td, color: isMissingClockOut ? colors.red : colors.text2, fontWeight: isMissingClockOut ? 700 : 400 }}>
                                {isMissingClockOut ? 'Missing' : formatTime(entry.clock_out)}
                              </td>
                              <td style={td}>{isMissingClockOut ? '—' : `${rawHours}h`}</td>
                              <td style={{ ...td, color: lunchDeduction !== '—' ? colors.amber : colors.text3 }}>
                                {isMissingClockOut ? '—' : (lunchDeduction === '—' ? '—' : `${lunchDeduction}h`)}
                              </td>
                              <td style={{ ...td, fontWeight: 700, color: colors.green }}>{isMissingClockOut ? '—' : `${netHours}h`}</td>
                              <td style={td}>{isOT ? <StatusChip status="medium" label="OT" /> : ''}</td>
                              <td style={{ ...td, color: colors.red, fontWeight: flagReason ? 700 : 400 }}>{flagReason}</td>
                              <td style={td}>{(entry.project as any)?.name ?? '—'}</td>
                              <td style={{ ...td, color: entry.notes ? colors.text2 : colors.text3, whiteSpace: 'normal' }}>{entry.notes || '—'}</td>
                            </tr>
                          );
                        })}
                        <tr style={{ borderTop: `2px solid ${colors.border}`, backgroundColor: colors.bg }}>
                          <td colSpan={3} style={{ ...td, fontWeight: 700, color: colors.text }}>Subtotal</td>
                          <td colSpan={3} style={{ ...td, fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: colors.text }}>{minutesToHours(employee.totalMinutes)}h</td>
                          <td colSpan={4} style={td}>
                            {regularHours}h regular{overtimeHours > 0 ? ` · ${overtimeHours}h overtime` : ''}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
