import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type PayrollSettings = {
  recipient_email: string;
  schedule_day: number;
  frequency: 'weekly' | 'biweekly' | 'manual';
  enabled: boolean;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function PayrollPage() {
  const [settings, setSettings] = useState<PayrollSettings>({
    recipient_email: '',
    schedule_day: 1,
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

  if (loading) {
    return <div style={{ padding: 32, color: '#F97316' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: 32, color: '#FFFFFF', maxWidth: 720 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, marginBottom: 4 }}>Payroll Reports</h1>
        <p style={{ color: '#6B7280', fontSize: 14, margin: 0 }}>
          Configure automated weekly payroll emails or send a report manually
        </p>
      </div>

      {/* Result banner */}
      {sendResult && (
        <div style={{
          marginBottom: 24,
          padding: '14px 20px',
          borderRadius: 10,
          backgroundColor: sendResult.success ? '#22C55E20' : '#EF444420',
          border: `1px solid ${sendResult.success ? '#22C55E' : '#EF4444'}`,
          color: sendResult.success ? '#22C55E' : '#EF4444',
          fontSize: 14,
          fontWeight: 600,
        }}>
          {sendResult.success ? '✓ ' : '✗ '}{sendResult.message}
        </div>
      )}

      {/* Manual Send Card */}
      <div style={{
        backgroundColor: '#111827', borderRadius: 16,
        border: '1px solid #1F2937', padding: 28, marginBottom: 24,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F97316', letterSpacing: 2, marginBottom: 20 }}>
          SEND REPORT NOW
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>REPORT PERIOD</label>
          <select
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
          style={{
            ...btnStyle,
            backgroundColor: '#F97316',
            opacity: sending || !settings.recipient_email ? 0.5 : 1,
            cursor: sending || !settings.recipient_email ? 'not-allowed' : 'pointer',
          }}
        >
          {sending ? 'Sending...' : 'Send Report Now'}
        </button>
        {!settings.recipient_email && (
          <p style={{ color: '#6B7280', fontSize: 12, marginTop: 8 }}>
            Set a recipient email below before sending.
          </p>
        )}
      </div>

      {/* Settings Card */}
      <div style={{
        backgroundColor: '#111827', borderRadius: 16,
        border: '1px solid #1F2937', padding: 28,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 20 }}>
          AUTOMATED SCHEDULE
        </div>

        {/* Recipient Email */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>RECIPIENT EMAIL</label>
          <input
            type="email"
            placeholder="payroll@yourcompany.com"
            value={settings.recipient_email}
            onChange={(e) => setSettings({ ...settings, recipient_email: e.target.value })}
            style={inputStyle}
          />
          <p style={{ color: '#4B5563', fontSize: 12, marginTop: 6 }}>
            This person will receive the Excel payroll report
          </p>
        </div>

        {/* Frequency */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>FREQUENCY</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['weekly', 'biweekly', 'manual'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setSettings({ ...settings, frequency: f })}
                style={{
                  padding: '10px 18px',
                  borderRadius: 10,
                  border: '1px solid',
                  borderColor: settings.frequency === f ? '#F97316' : '#1F2937',
                  backgroundColor: settings.frequency === f ? '#F9731620' : '#0D1321',
                  color: settings.frequency === f ? '#F97316' : '#6B7280',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {f === 'biweekly' ? 'Bi-Weekly' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Send Day */}
        {settings.frequency !== 'manual' && (
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>SEND ON</label>
            <select
              value={settings.schedule_day}
              onChange={(e) => setSettings({ ...settings, schedule_day: parseInt(e.target.value) })}
              style={selectStyle}
            >
              {DAYS.map((day, i) => (
                <option key={i} value={i}>{day}</option>
              ))}
            </select>
            <p style={{ color: '#4B5563', fontSize: 12, marginTop: 6 }}>
              Report will automatically send every {settings.frequency === 'biweekly' ? 'other' : ''} {DAYS[settings.schedule_day]}
            </p>
          </div>
        )}

        {/* Enable toggle */}
        {settings.frequency !== 'manual' && (
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              style={{
                width: 48, height: 26, borderRadius: 13,
                backgroundColor: settings.enabled ? '#F97316' : '#1F2937',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute',
                top: 3, left: settings.enabled ? 25 : 3,
                width: 20, height: 20, borderRadius: 10,
                backgroundColor: '#FFFFFF', transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: 14, color: settings.enabled ? '#22C55E' : '#6B7280', fontWeight: 600 }}>
              {settings.enabled ? 'Automated reports ON' : 'Automated reports OFF'}
            </span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{ ...btnStyle, backgroundColor: '#1F2937', border: '1px solid #374151', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#6B7280',
  letterSpacing: 2, display: 'block', marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px',
  backgroundColor: '#0D1321', border: '1px solid #1F2937',
  borderRadius: 10, color: '#FFFFFF', fontSize: 15,
  outline: 'none', boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  padding: '12px 16px', backgroundColor: '#0D1321',
  border: '1px solid #1F2937', borderRadius: 10,
  color: '#FFFFFF', fontSize: 14, outline: 'none',
  cursor: 'pointer', minWidth: 200,
};

const btnStyle: React.CSSProperties = {
  padding: '14px 24px', borderRadius: 10, border: 'none',
  color: '#FFFFFF', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', letterSpacing: 1,
};