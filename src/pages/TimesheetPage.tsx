import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function TimesheetPage() {
  const [weekOffset, setWeekOffset] = useState(-1);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

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
        .select(`
          *,
          profile:user_id (id, full_name),
          project:project_id (name)
        `)
        .eq('company_id', companyData.id)
        .gte('clock_in', start.toISOString())
        .lte('clock_in', end.toISOString())
        .not('clock_out', 'is', null)
        .order('clock_in', { ascending: true });
      if (error) throw error;
      return data ?? [];
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

  // Group entries by employee
  const byEmployee: Record<string, { name: string; entries: any[]; totalMinutes: number }> = {};
  for (const entry of entries ?? []) {
    const name = (entry as any).profile?.full_name ?? 'Unknown';
    const userId = (entry as any).profile?.id ?? entry.user_id;
    if (!byEmployee[userId]) {
      byEmployee[userId] = { name, entries: [], totalMinutes: 0 };
    }
    byEmployee[userId].entries.push(entry);
    byEmployee[userId].totalMinutes += (entry as any).total_minutes ?? 0;
  }

  const totalHours = Object.values(byEmployee).reduce((sum, e) => sum + e.totalMinutes, 0);

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

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px', backgroundColor: '#0D1321',
    border: '1px solid #1F2937', borderRadius: 8,
    color: '#FFFFFF', fontSize: 14, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{ padding: 32, color: '#FFFFFF', maxWidth: 960 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Timesheet Viewer</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
          Review hours worked by your team for any week
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            style={{ ...inputStyle, padding: '10px 16px', fontWeight: 700 }}
          >
            ←
          </button>
          <div style={{ backgroundColor: '#111827', borderRadius: 10, padding: '10px 20px', border: '1px solid #1F2937', fontSize: 14, fontWeight: 600, minWidth: 240, textAlign: 'center' }}>
            {weekOffset === 0 ? 'This Week' : weekOffset === -1 ? 'Last Week' : `${Math.abs(weekOffset)} Weeks Ago`} · {weekLabel}
          </div>
          <button
            onClick={() => setWeekOffset(w => Math.min(w + 1, 0))}
            disabled={weekOffset >= 0}
            style={{ ...inputStyle, padding: '10px 16px', fontWeight: 700, opacity: weekOffset >= 0 ? 0.4 : 1 }}
          >
            →
          </button>
        </div>
        <button
          onClick={handleSendReport}
          disabled={sending}
          style={{ padding: '10px 24px', backgroundColor: sending ? '#374151' : '#F97316', border: 'none', borderRadius: 10, color: sending ? '#6B7280' : '#0A0F1E', fontSize: 14, fontWeight: 800, cursor: sending ? 'not-allowed' : 'pointer' }}
        >
          {sending ? 'Sending...' : '📧 Email Report'}
        </button>
      </div>

      {/* Result banner */}
      {sendResult && (
        <div style={{ marginBottom: 20, padding: '12px 20px', borderRadius: 10, backgroundColor: sendResult.success ? '#22C55E20' : '#EF444420', border: `1px solid ${sendResult.success ? '#22C55E' : '#EF4444'}`, color: sendResult.success ? '#22C55E' : '#EF4444', fontSize: 14, fontWeight: 600 }}>
          {sendResult.success ? '✓ ' : '✗ '}{sendResult.message}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ backgroundColor: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1F2937', borderLeftWidth: 3, borderLeftColor: '#F97316' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>TOTAL HOURS</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#FFFFFF' }}>{minutesToHours(totalHours)}h</div>
        </div>
        <div style={{ backgroundColor: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1F2937', borderLeftWidth: 3, borderLeftColor: '#378ADD' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>EMPLOYEES</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#FFFFFF' }}>{Object.keys(byEmployee).length}</div>
        </div>
        <div style={{ backgroundColor: '#111827', borderRadius: 12, padding: 20, border: '1px solid #1F2937', borderLeftWidth: 3, borderLeftColor: '#22C55E' }}>
          <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>CLOCK-INS</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#FFFFFF' }}>{entries?.length ?? 0}</div>
        </div>
      </div>

      {/* Timesheet Table */}
      {isLoading ? (
        <div style={{ color: '#F97316', padding: 24 }}>Loading...</div>
      ) : Object.keys(byEmployee).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#4B5563' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⏱</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#FFFFFF', marginBottom: 6 }}>No time entries</div>
          <div style={{ fontSize: 14 }}>No one clocked in during this week.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(byEmployee).map(([userId, employee]) => {
            const isExpanded = expandedEmployee === userId;
            const regularHours = Math.min(minutesToHours(employee.totalMinutes), 40);
            const overtimeHours = Math.max(0, minutesToHours(employee.totalMinutes) - 40);
            return (
              <div key={userId} style={{ backgroundColor: '#111827', borderRadius: 14, border: '1px solid #1F2937', overflow: 'hidden' }}>
                {/* Employee header */}
                <button
                  onClick={() => setExpandedEmployee(isExpanded ? null : userId)}
                  style={{ width: '100%', padding: '16px 20px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#FFFFFF' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#F97316' }}>
                      {employee.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{employee.name}</div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {employee.entries.length} shift{employee.entries.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#FFFFFF' }}>{minutesToHours(employee.totalMinutes)}h</div>
                      {overtimeHours > 0 && (
                        <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 700 }}>+{overtimeHours}h OT</div>
                      )}
                    </div>
                    <div style={{ fontSize: 16, color: '#6B7280' }}>{isExpanded ? '▲' : '▼'}</div>
                  </div>
                </button>

                {/* Expanded entries */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #1F2937' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#0D1321' }}>
                          {['Date', 'Clock In', 'Clock Out', 'Hours', 'Project', 'Notes'].map((h) => (
                            <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 1 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {employee.entries.map((entry: any, i: number) => (
                          <tr key={entry.id} style={{ borderTop: '1px solid #1F2937', backgroundColor: i % 2 === 0 ? 'transparent' : '#0D132120' }}>
                            <td style={{ padding: '10px 16px', fontSize: 13 }}>{formatDate(entry.clock_in)}</td>
                            <td style={{ padding: '10px 16px', fontSize: 13, color: '#9CA3AF' }}>{formatTime(entry.clock_in)}</td>
                            <td style={{ padding: '10px 16px', fontSize: 13, color: '#9CA3AF' }}>{entry.clock_out ? formatTime(entry.clock_out) : '—'}</td>
                            <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#22C55E' }}>{minutesToHours(entry.total_minutes ?? 0)}h</td>
                            <td style={{ padding: '10px 16px', fontSize: 13, color: '#9CA3AF' }}>{(entry.project as any)?.name ?? '—'}</td>
                            <td style={{ padding: '10px 16px', fontSize: 12, color: '#6B7280' }}>{entry.notes || '—'}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: '2px solid #374151', backgroundColor: '#F9731608' }}>
                          <td colSpan={3} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, color: '#F97316' }}>Subtotal</td>
                          <td style={{ padding: '10px 16px', fontSize: 14, fontWeight: 900, color: '#F97316' }}>{minutesToHours(employee.totalMinutes)}h</td>
                          <td colSpan={2} style={{ padding: '10px 16px', fontSize: 12, color: '#6B7280' }}>
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