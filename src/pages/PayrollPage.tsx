import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useIsMobile } from '../hooks/useIsMobile';
import { btn, card, colors, fonts, input, radius, tint } from '../theme';
import PageHeader from '../components/ui/PageHeader';
import StatusChip from '../components/ui/StatusChip';
import Skeleton from '../components/ui/Skeleton';
import SegmentedControl from '../components/ui/SegmentedControl';
import Icon from '../components/ui/Icon';

type PayrollSettings = {
  recipient_email: string;
  schedule_day: number;
  schedule_hour: number;
  schedule_minute: number;
  frequency: 'weekly' | 'biweekly' | 'manual';
  enabled: boolean;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const suffix = i < 12 ? 'AM' : 'PM';
  const hour = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${hour}:00 ${suffix}` };
});

const MINUTES = [
  { value: 0, label: ':00' },
  { value: 15, label: ':15' },
  { value: 30, label: ':30' },
  { value: 45, label: ':45' },
];

export default function PayrollPage() {
  const [settings, setSettings] = useState<PayrollSettings>({
    recipient_email: '',
    schedule_day: 1,
    schedule_hour: 7,
    schedule_minute: 0,
    frequency: 'weekly',
    enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(-1);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) return;
      setCompanyId(profile.company_id);

      const { data } = await supabase
        .from('payroll_settings')
        .select('*')
        .eq('company_id', profile.company_id)
        .single();

      if (data) {
        setSettings({
          recipient_email: data.recipient_email ?? '',
          schedule_day: data.schedule_day ?? 1,
          schedule_hour: data.schedule_hour ?? 7,
          schedule_minute: data.schedule_minute ?? 0,
          frequency: data.frequency ?? 'weekly',
          enabled: data.enabled ?? false,
        });
      }
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('payroll_settings')
        .upsert({
          company_id: companyId,
          recipient_email: settings.recipient_email,
          schedule_day: settings.schedule_day,
          schedule_hour: settings.schedule_hour,
          schedule_minute: settings.schedule_minute,
          frequency: settings.frequency,
          enabled: settings.enabled,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'company_id' });

      if (error) throw error;
      setSendResult({ success: true, message: 'Settings saved successfully.' });
      setTimeout(() => setSendResult(null), 3000);
    } catch (e: any) {
      setSendResult({ success: false, message: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    if (!companyId || !settings.recipient_email) {
      setSendResult({ success: false, message: 'Please enter a recipient email first.' });
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
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            recipientEmail: settings.recipient_email,
            companyId,
            weekOffset,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send report');
      setSendResult({ success: true, message: `Report sent to ${settings.recipient_email} for week of ${data.week}` });
    } catch (e: any) {
      setSendResult({ success: false, message: e.message });
    } finally {
      setSending(false);
    }
  }

  function formatScheduleTime() {
    const h = settings.schedule_hour;
    const m = settings.schedule_minute;
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const minute = m === 0 ? '00' : m.toString();
    return `${hour}:${minute} ${suffix}`;
  }

  const isMobile = useIsMobile();
  const nextSend = nextScheduledSend(settings);
  const frequencyLabel = settings.frequency === 'biweekly' ? 'Bi-weekly' : settings.frequency === 'weekly' ? 'Weekly' : 'Manual only';
  const automatedOn = settings.enabled && settings.frequency !== 'manual';

  if (loading) {
    return (
      <div style={{ padding: isMobile ? 16 : 32 }} role="status" aria-label="Loading payroll settings">
        <Skeleton width={260} height={34} />
        <Skeleton width={340} height={14} style={{ marginTop: 10, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px', gap: 20 }}>
          <Skeleton height={320} radius={12} />
          <Skeleton height={220} radius={12} />
        </div>
      </div>
    );
  }

  const panel: React.CSSProperties = { ...card, padding: isMobile ? 16 : 24, marginBottom: 20 };
  const panelTitle: React.CSSProperties = { margin: '0 0 16px', fontFamily: fonts.display, fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', color: colors.text };
  const summaryRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderTop: `1px solid ${colors.border}` };

  return (
    <div style={{ padding: isMobile ? 16 : 32, color: colors.text }}>
      <PageHeader title="Payroll Reports" subtitle="Configure automated weekly payroll emails or send a report manually" />

      {/* Result banner */}
      {sendResult && (
        <div role={sendResult.success ? 'status' : 'alert'} style={{
          marginBottom: 20, padding: '12px 16px', borderRadius: radius.control, display: 'flex', alignItems: 'center', gap: 8,
          backgroundColor: tint(sendResult.success ? colors.green : colors.red, 0.12),
          border: `1px solid ${tint(sendResult.success ? colors.green : colors.red, 0.5)}`,
          color: sendResult.success ? colors.green : colors.red,
          fontSize: 14, fontWeight: 600,
        }}>
          <Icon name={sendResult.success ? 'check' : 'alert'} size={15} strokeWidth={sendResult.success ? 3 : 2.25} />
          {sendResult.message}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {/* Manual Send Card */}
          <section style={panel} aria-labelledby="payroll-send-title">
            <h2 id="payroll-send-title" style={panelTitle}>Send report now</h2>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="report-period" style={labelStyle}>Report period</label>
              <select
                id="report-period"
                value={weekOffset}
                onChange={(e) => setWeekOffset(parseInt(e.target.value))}
                style={selectStyle}
              >
                <option value={-1}>Last Week</option>
                <option value={0}>This Week (so far)</option>
                <option value={-2}>2 Weeks Ago</option>
                <option value={-3}>3 Weeks Ago</option>
              </select>
            </div>
            <button
              onClick={handleSendNow}
              disabled={sending || !settings.recipient_email}
              {...btn('primary')}
            >
              <Icon name="mail" size={15} /> {sending ? 'Sending...' : 'Send report now'}
            </button>
            {!settings.recipient_email && (
              <p style={{ color: colors.text3, fontSize: 13, margin: '8px 0 0' }}>
                Set a recipient email below before sending.
              </p>
            )}
          </section>

          {/* Settings Card */}
          <section style={panel} aria-labelledby="payroll-schedule-title">
            <h2 id="payroll-schedule-title" style={panelTitle}>Automated schedule</h2>

            {/* Recipient Email */}
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="recipient-email" style={labelStyle}>Recipient email</label>
              <input
                id="recipient-email"
                type="email"
                placeholder="payroll@yourcompany.com"
                value={settings.recipient_email}
                onChange={(e) => setSettings({ ...settings, recipient_email: e.target.value })}
                style={inputStyle}
              />
              <p style={{ color: colors.text3, fontSize: 12, margin: '6px 0 0' }}>
                This person will receive the Excel payroll report
              </p>
            </div>

            {/* Frequency */}
            <div style={{ marginBottom: 18 }}>
              <span style={labelStyle}>Frequency</span>
              <SegmentedControl
                label="Frequency"
                options={[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Bi-Weekly' }, { value: 'manual', label: 'Manual' }]}
                value={settings.frequency}
                onChange={(f) => setSettings({ ...settings, frequency: f as PayrollSettings['frequency'] })}
              />
            </div>

            {settings.frequency !== 'manual' && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 14, marginBottom: 6 }}>
                {/* Send Day */}
                <div>
                  <label htmlFor="send-day" style={labelStyle}>Send on</label>
                  <select
                    id="send-day"
                    value={settings.schedule_day}
                    onChange={(e) => setSettings({ ...settings, schedule_day: parseInt(e.target.value) })}
                    style={selectStyle}
                  >
                    {DAYS.map((day, i) => (
                      <option key={i} value={i}>{day}</option>
                    ))}
                  </select>
                </div>
                {/* Send Time */}
                <div>
                  <label htmlFor="send-hour" style={labelStyle}>Send at</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      id="send-hour"
                      value={settings.schedule_hour}
                      onChange={(e) => setSettings({ ...settings, schedule_hour: parseInt(e.target.value) })}
                      style={{ ...selectStyle, flex: 1 }}
                    >
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Minutes"
                      value={settings.schedule_minute}
                      onChange={(e) => setSettings({ ...settings, schedule_minute: parseInt(e.target.value) })}
                      style={{ ...selectStyle, width: 88, flex: '0 0 auto' }}
                    >
                      {MINUTES.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
            {settings.frequency !== 'manual' && (
              <p style={{ color: colors.text2, fontSize: 13, margin: '6px 0 18px' }}>
                Report will send every {settings.frequency === 'biweekly' ? 'other' : ''} {DAYS[settings.schedule_day]} at {formatScheduleTime()} (Central time)
              </p>
            )}

            {/* Enable toggle */}
            {settings.frequency !== 'manual' && (
              <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.enabled}
                  aria-label="Automated reports"
                  onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                  style={{
                    width: 48, height: 26, borderRadius: 13, border: `1px solid ${settings.enabled ? colors.accent : colors.border}`, padding: 0,
                    backgroundColor: settings.enabled ? colors.accent : colors.surface2,
                    position: 'relative', cursor: 'pointer', transition: 'background-color 150ms ease', flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: settings.enabled ? 24 : 2,
                    width: 20, height: 20, borderRadius: 10,
                    backgroundColor: settings.enabled ? colors.onAccent : colors.text2, transition: 'left 150ms ease',
                  }} />
                </button>
                <span style={{ fontSize: 14, color: settings.enabled ? colors.green : colors.text2, fontWeight: 600 }}>
                  {settings.enabled ? 'Automated reports ON' : 'Automated reports OFF'}
                </span>
              </div>
            )}

            <button onClick={handleSave} disabled={saving} {...btn('secondary')}>
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </section>
        </div>

        {/* Summary */}
        <aside style={{ ...card, padding: isMobile ? 16 : 22, position: isMobile ? 'static' : 'sticky', top: 16 }} aria-labelledby="payroll-summary-title">
          <h2 id="payroll-summary-title" style={{ ...panelTitle, marginBottom: 6 }}>Summary</h2>
          <p style={{ fontSize: 12, color: colors.text3, margin: '0 0 6px' }}>Shows the settings on this page. Save to apply changes.</p>
          <div style={summaryRow}>
            <span style={{ fontSize: 13, color: colors.text2 }}>Automated reports</span>
            <StatusChip status={automatedOn ? 'active' : 'archived'} label={automatedOn ? 'On' : 'Off'} />
          </div>
          <div style={summaryRow}>
            <span style={{ fontSize: 13, color: colors.text2 }}>Recipient</span>
            <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere', color: settings.recipient_email ? colors.text : colors.text3 }}>{settings.recipient_email || 'Not set'}</span>
          </div>
          <div style={summaryRow}>
            <span style={{ fontSize: 13, color: colors.text2 }}>Frequency</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{frequencyLabel}</span>
          </div>
          <div style={summaryRow}>
            <span style={{ fontSize: 13, color: colors.text2 }}>Schedule</span>
            <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>
              {settings.frequency === 'manual' ? '—' : `${DAYS[settings.schedule_day]}s, ${formatScheduleTime()} CT`}
            </span>
          </div>
          <div style={{ ...summaryRow, flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, color: colors.text2 }}>Next send</span>
            <span style={{ fontFamily: fonts.display, fontSize: 24, fontWeight: 700, lineHeight: 1.1, color: automatedOn ? colors.text : colors.text3 }}>
              {automatedOn && nextSend ? nextSend : 'Not scheduled'}
            </span>
            {!automatedOn && settings.frequency !== 'manual' && <span style={{ fontSize: 12, color: colors.text3 }}>Turn on automated reports and save to schedule.</span>}
          </div>
        </aside>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: colors.text2,
  display: 'block', marginBottom: 6,
};

const inputStyle: React.CSSProperties = { ...input, backgroundColor: colors.bg };

const selectStyle: React.CSSProperties = { ...input, backgroundColor: colors.bg, cursor: 'pointer' };

/**
 * Next time the automated check will send, worked out the same way automated-payroll-check does:
 * day and hour in America/Chicago, and for bi-weekly only on weeks where
 * floor((Central wall-clock time - 2024-01-01) / 7 days) is even.
 */
function nextScheduledSend(s: PayrollSettings): string | null {
  if (s.frequency === 'manual') return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date())
    .reduce((m: Record<string, number>, p) => (p.type !== 'literal' ? { ...m, [p.type]: Number(p.value) } : m), {});
  // Central wall-clock "now" expressed as a UTC timestamp (matches the edge function's centralTime).
  const nowWall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const epoch = Date.UTC(2024, 0, 1);
  for (let add = 0; add < 21; add++) {
    const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + add, s.schedule_hour, s.schedule_minute));
    if (day.getUTCDay() !== s.schedule_day) continue;
    if (day.getTime() + 14 * 60 * 1000 < nowWall) continue;
    if (s.frequency === 'biweekly' && Math.floor((day.getTime() - epoch) / WEEK) % 2 !== 0) continue;
    return day.toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
  }
  return null;
}
