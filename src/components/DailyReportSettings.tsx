import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Automatic daily report settings for one project (Edit Project panel).
// Visibility uses can_manage_project_reports, the same function the RLS policies use, so
// the UI never offers something the database would refuse: company admins and project
// managers of the company that owns this project.

const MAX_RECIPIENTS = 25;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Settings = {
  project_id: string;
  enabled: boolean;
  send_time: string;
  timezone: string;
  last_sent_at: string | null;
  export_email_enabled: boolean;
  export_last_sent_at: string | null;
};

type RecipientRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  profile: { full_name: string | null; email: string | null } | null;
};

type Candidate = { user_id: string; full_name: string; email: string | null };

function describeError(e: any): string {
  switch (e?.code) {
    case 'RPT01': return `This project already has the maximum of ${MAX_RECIPIENTS} recipients. Remove one to add another.`;
    case 'RPT02': return 'That email address is not valid.';
    case 'RPT03': return 'That person is not a member of this project or its company.';
    case 'RPT04': return 'That timezone is not recognized.';
    case '23505': return 'That recipient is already on the list.';
    case '42501': return 'You do not have permission to change report settings for this project.';
    default: return e?.message ?? 'Something went wrong.';
  }
}

function timezoneLabel(timeZone: string): string {
  try {
    const abbr = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    return abbr ? `${timeZone} (${abbr})` : timeZone;
  } catch {
    return timeZone;
  }
}

const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: 2, marginBottom: 6 };
const input: React.CSSProperties = { padding: '10px 12px', backgroundColor: '#0A0F1E', border: '1px solid #374151', borderRadius: 8, color: '#FFFFFF', fontSize: 14, boxSizing: 'border-box' };
const secondaryBtn: React.CSSProperties = { padding: '10px 14px', backgroundColor: 'transparent', border: '1px solid #374151', borderRadius: 8, color: '#D1D5DB', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '10px 16px', backgroundColor: '#F97316', border: 'none', borderRadius: 8, color: '#0A0F1E', fontSize: 13, fontWeight: 800, cursor: 'pointer' };

export function DailyReportSettings({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data: canManage, isLoading: checkingAccess } = useQuery({
    queryKey: ['report-settings-can-manage', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_manage_project_reports', { p_project_id: projectId });
      if (error) return false;
      return data === true;
    },
    enabled: !!projectId,
  });

  const { data: settings } = useQuery({
    queryKey: ['report-settings', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_report_settings')
        .select('project_id, enabled, send_time, timezone, last_sent_at, export_email_enabled, export_last_sent_at')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
    enabled: !!projectId && canManage === true,
  });

  const { data: recipients } = useQuery({
    queryKey: ['report-recipients', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_report_recipients')
        .select('id, user_id, email, profile:user_id (full_name, email)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RecipientRow[];
    },
    enabled: !!projectId && canManage === true,
  });

  // Project members plus members of the company that owns the project (the creator's company).
  const { data: candidates } = useQuery({
    queryKey: ['report-recipient-candidates', projectId],
    queryFn: async () => {
      const byId = new Map<string, Candidate>();
      const add = (userId: string, profile: any) => {
        if (!userId || byId.has(userId)) return;
        byId.set(userId, { user_id: userId, full_name: profile?.full_name || 'Unknown user', email: profile?.email ?? null });
      };

      const { data: members } = await supabase
        .from('project_members')
        .select('user_id, profile:user_id (full_name, email)')
        .eq('project_id', projectId);
      for (const m of members ?? []) add((m as any).user_id, (m as any).profile);

      const { data: project } = await supabase.from('projects').select('created_by').eq('id', projectId).maybeSingle();
      if (project?.created_by) {
        const { data: creator } = await supabase.from('profiles').select('company_id').eq('id', project.created_by).maybeSingle();
        if (creator?.company_id) {
          const { data: companyMembers } = await supabase
            .from('company_members')
            .select('user_id, profile:user_id (full_name, email)')
            .eq('company_id', creator.company_id);
          for (const m of companyMembers ?? []) add((m as any).user_id, (m as any).profile);
        }
      }
      return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    enabled: !!projectId && canManage === true,
  });

  const [enabled, setEnabled] = useState(false);
  const [exportEmailEnabled, setExportEmailEnabled] = useState(false);
  const [sendTime, setSendTime] = useState('17:00');
  const [testingSheet, setTestingSheet] = useState(false);
  const [sheetTestMessage, setSheetTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [recipientBusy, setRecipientBusy] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // '' = me (login email); otherwise a project_report_recipients.id. The server resolves the
  // address from these ids itself; the browser never sends an email address.
  const [testTarget, setTestTarget] = useState('');

  // The signed-in user's login email (auth.users), which is what "me" resolves to server-side.
  const { data: loginEmail } = useQuery({
    queryKey: ['report-settings-login-email'],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.email ?? null;
    },
    enabled: canManage === true,
  });

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setExportEmailEnabled(!!settings.export_email_enabled);
      setSendTime(settings.send_time.slice(0, 5));
    }
  }, [settings]);

  const timezone = settings?.timezone ?? 'America/Chicago';
  const recipientCount = recipients?.length ?? 0;
  const atCap = recipientCount >= MAX_RECIPIENTS;
  const dirty = settings
    ? (settings.enabled !== enabled || !!settings.export_email_enabled !== exportEmailEnabled || settings.send_time.slice(0, 5) !== sendTime)
    : (enabled || exportEmailEnabled || sendTime !== '17:00');

  // Same resolution as the scheduled send: team member -> profiles.email, external -> stored email.
  const recipientAddress = (r: RecipientRow) => (r.user_id ? r.profile?.email || null : r.email);
  const selectedTestRecipient = (recipients ?? []).find((r) => r.id === testTarget) ?? null;
  const testAddress = testTarget ? (selectedTestRecipient ? recipientAddress(selectedTestRecipient) : null) : (loginEmail ?? null);

  const availableCandidates = useMemo(() => {
    const taken = new Set((recipients ?? []).map((r) => r.user_id).filter(Boolean));
    return (candidates ?? []).filter((c) => !taken.has(c.user_id));
  }, [candidates, recipients]);

  if (checkingAccess || canManage !== true) return null;

  function refreshRecipients() {
    queryClient.invalidateQueries({ queryKey: ['report-recipients', projectId] });
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      // project_id is insert-only for clients, so insert the row once, then update it.
      const { error } = settings
        ? await supabase.from('project_report_settings').update({ enabled, export_email_enabled: exportEmailEnabled, send_time: sendTime }).eq('project_id', projectId)
        : await supabase.from('project_report_settings').insert({ project_id: projectId, enabled, export_email_enabled: exportEmailEnabled, send_time: sendTime, timezone });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['report-settings', projectId] });
      setSaveMessage({ ok: true, text: 'Report settings saved.' });
    } catch (e: any) {
      setSaveMessage({ ok: false, text: describeError(e) });
    } finally {
      setSaving(false);
    }
  }

  async function addRecipient(row: { user_id?: string; email?: string }) {
    setRecipientBusy(true);
    setRecipientError(null);
    try {
      const { error } = await supabase.from('project_report_recipients').insert({ project_id: projectId, ...row });
      if (error) throw error;
      setSelectedUserId('');
      setNewEmail('');
      refreshRecipients();
    } catch (e: any) {
      setRecipientError(describeError(e));
    } finally {
      setRecipientBusy(false);
    }
  }

  function handleAddEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setRecipientError('Enter a valid email address, for example name@company.com.');
      return;
    }
    const duplicate = (recipients ?? []).some((r) => (r.email ?? r.profile?.email ?? '').toLowerCase() === email);
    if (duplicate) {
      setRecipientError('That email address is already on the list.');
      return;
    }
    addRecipient({ email });
  }

  async function removeRecipient(id: string) {
    setRecipientBusy(true);
    setRecipientError(null);
    try {
      const { error } = await supabase.from('project_report_recipients').delete().eq('id', id);
      if (error) throw error;
      refreshRecipients();
    } catch (e: any) {
      setRecipientError(describeError(e));
    } finally {
      setRecipientBusy(false);
    }
  }

  async function handleTestSpreadsheet() {
    setTestingSheet(true);
    setSheetTestMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('send-project-export', { body: { projectId } });
      if (error) {
        let detail = error.message;
        try { detail = (await (error as any).context?.json())?.error ?? detail; } catch { /* keep message */ }
        throw new Error(detail);
      }
      if (!data?.success) throw new Error(data?.error ?? 'The test spreadsheet could not be sent.');
      const c = data.counts ?? {};
      setSheetTestMessage({ ok: true, text: `Test spreadsheet sent to ${data.sent_to}: ${c.open ?? 0} Open, ${c.in_progress ?? 0} In Progress, ${c.done ?? 0} Done.` });
    } catch (e: any) {
      setSheetTestMessage({ ok: false, text: e?.message ?? 'The test spreadsheet could not be sent.' });
    } finally {
      setTestingSheet(false);
    }
  }

  async function handleTestSend() {
    setTesting(true);
    setTestMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('send-daily-reports', {
        body: testTarget ? { projectId, recipientId: testTarget } : { projectId },
      });
      if (error) {
        let detail = error.message;
        try { detail = (await (error as any).context?.json())?.error ?? detail; } catch { /* keep message */ }
        throw new Error(detail);
      }
      if (!data?.success) throw new Error(data?.error ?? 'The test report could not be sent.');
      setTestMessage({ ok: true, text: `Test report sent to ${data.sent_to}. It includes ${data.activity_count} activity entr${data.activity_count === 1 ? 'y' : 'ies'}.` });
    } catch (e: any) {
      setTestMessage({ ok: false, text: e?.message ?? 'The test report could not be sent.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ marginBottom: 20, padding: 16, backgroundColor: '#0D1321', border: '1px solid #1F2937', borderRadius: 10 }}>
      <div style={{ ...label, color: '#F97316', marginBottom: 4 }}>AUTOMATIC DAILY REPORT</div>
      <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 16 }}>
        Emails a summary of that day's activity on this project, including who made each change. Nobody on site needs to fill anything in.
      </div>

      {/* Toggle */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#F97316', cursor: 'pointer' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Send automatic daily report</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 16 }}>
        <input type="checkbox" checked={exportEmailEnabled} onChange={(e) => setExportEmailEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#F97316', cursor: 'pointer', marginTop: 1 }} />
        <span>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Email the project spreadsheet daily</span>
          <span style={{ display: 'block', fontSize: 12, color: '#6B7280', marginTop: 2 }}>
            A separate email with the task spreadsheet attached, sent at the send time below to the recipients below. Not sent on days when the project has no tasks.
            {settings?.export_last_sent_at ? ` Last sent ${new Date(settings.export_last_sent_at).toLocaleString()}.` : ''}
          </span>
        </span>
      </label>

      {/* Send time */}
      <div style={{ marginBottom: 16 }}>
        <label style={label} htmlFor="daily-report-time">SEND TIME</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input id="daily-report-time" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} style={{ ...input, width: 140 }} />
          <span style={{ fontSize: 13, color: '#9CA3AF' }}>{timezoneLabel(timezone)}</span>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>
          Each report covers one day only: what happened from midnight ({timezoneLabel(timezone)}) until the send time that day.
          Activity after the send time, or on a day whose report could not be sent within 2 hours of the send time, is not included in any later report.
          {settings?.last_sent_at ? ` Last sent ${new Date(settings.last_sent_at).toLocaleString()}.` : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
        <button onClick={handleSave} disabled={saving || !dirty} style={{ ...primaryBtn, opacity: saving || !dirty ? 0.5 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving...' : 'Save report settings'}
        </button>
        {saveMessage && <span style={{ fontSize: 13, color: saveMessage.ok ? '#22C55E' : '#EF4444' }}>{saveMessage.text}</span>}
      </div>

      {/* Recipients */}
      <div style={{ ...label, marginBottom: 8 }}>RECIPIENTS ({recipientCount} of {MAX_RECIPIENTS})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {(recipients ?? []).length === 0 && (
          <div style={{ fontSize: 13, color: '#6B7280' }}>No recipients yet. Reports are not sent until at least one recipient is added.</div>
        )}
        {(recipients ?? []).map((r) => {
          const isUser = !!r.user_id;
          const name = isUser ? (r.profile?.full_name || 'Unknown user') : r.email;
          const detail = isUser ? (r.profile?.email || null) : 'External email';
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 12px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#FFFFFF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                {detail
                  ? <div style={{ fontSize: 12, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
                  : <div style={{ fontSize: 12, color: '#F59E0B' }}>No email on file. This person will be skipped until they add one.</div>}
              </div>
              <button onClick={() => removeRecipient(r.id)} disabled={recipientBusy} style={{ ...secondaryBtn, padding: '6px 10px', fontSize: 12, color: '#EF4444', borderColor: '#EF444460', flexShrink: 0 }}>
                Remove
              </button>
            </div>
          );
        })}
      </div>

      {atCap ? (
        <div style={{ fontSize: 13, color: '#F59E0B', marginBottom: 12 }}>
          This project has reached the limit of {MAX_RECIPIENTS} recipients. Remove one to add another.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={{ ...input, flex: '1 1 220px', cursor: 'pointer' }} aria-label="Team member">
              <option value="">Select a team member</option>
              {availableCandidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>{c.full_name}{c.email ? ` (${c.email})` : ' (no email on file)'}</option>
              ))}
            </select>
            <button onClick={() => selectedUserId && addRecipient({ user_id: selectedUserId })} disabled={!selectedUserId || recipientBusy} style={{ ...secondaryBtn, opacity: !selectedUserId || recipientBusy ? 0.5 : 1 }}>
              Add team member
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setRecipientError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddEmail(); }}
              placeholder="name@company.com"
              aria-label="Email address"
              style={{ ...input, flex: '1 1 220px' }}
            />
            <button onClick={handleAddEmail} disabled={!newEmail.trim() || recipientBusy} style={{ ...secondaryBtn, opacity: !newEmail.trim() || recipientBusy ? 0.5 : 1 }}>
              Add email
            </button>
          </div>
        </div>
      )}
      {recipientError && <div style={{ fontSize: 13, color: '#EF4444', marginBottom: 12 }}>{recipientError}</div>}

      {/* Test send */}
      <div style={{ borderTop: '1px solid #1F2937', paddingTop: 14 }}>
        <label style={label} htmlFor="daily-report-test-target">SEND A TEST REPORT TO</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            id="daily-report-test-target"
            value={testTarget}
            onChange={(e) => { setTestTarget(e.target.value); setTestMessage(null); }}
            style={{ ...input, flex: '1 1 220px', cursor: 'pointer' }}
          >
            <option value="">Me ({loginEmail ?? 'your login email'})</option>
            {(recipients ?? []).map((r) => {
              const address = recipientAddress(r);
              const name = r.user_id ? (r.profile?.full_name || 'Unknown user') : null;
              return (
                <option key={r.id} value={r.id} disabled={!address}>
                  {name ? `${name} (${address ?? 'no email on file'})` : address}
                </option>
              );
            })}
          </select>
          <button onClick={handleTestSend} disabled={testing || !testAddress} style={{ ...secondaryBtn, opacity: testing || !testAddress ? 0.5 : 1 }}>
            {testing ? 'Sending...' : testAddress ? `Send test report to ${testAddress}` : 'Send test report'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>
          Sends today's report so far (from midnight project time until now) to the selected address only. It does not affect the scheduled report. Limited to 5 test sends per project per hour.
        </div>
      </div>
      {testMessage && <div style={{ fontSize: 13, color: testMessage.ok ? '#22C55E' : '#EF4444', marginTop: 10 }}>{testMessage.text}</div>}

      {/* Spreadsheet email test: always to the signed-in user's login email only */}
      <div style={{ borderTop: '1px solid #1F2937', paddingTop: 14, marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleTestSpreadsheet} disabled={testingSheet || !loginEmail} style={{ ...secondaryBtn, opacity: testingSheet || !loginEmail ? 0.5 : 1 }}>
            {testingSheet ? 'Sending...' : `Send test spreadsheet to ${loginEmail ?? 'me'}`}
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>
          Sends the spreadsheet email, with the current file attached, to your login email only. Limited to 5 test sends per project per hour.
        </div>
        {sheetTestMessage && <div role="status" style={{ fontSize: 13, color: sheetTestMessage.ok ? '#22C55E' : '#EF4444', marginTop: 10 }}>{sheetTestMessage.text}</div>}
      </div>
    </div>
  );
}
