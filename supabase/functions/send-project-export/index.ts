import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExcelJS from 'npm:exceljs@4.4.0';
import { corsHeaders, json, bearer, isServiceRole, resolveRecipients, esc, sleep, toBase64, FROM, UUID_RE, Recipient } from '../_shared/common.ts';
import { buildWorkbook, loadExportData, exportFileName, ExportCounts } from '../_shared/project_export.ts';
import { evaluateDue, localDateOf, formatLocalDate } from '../_shared/schedule.ts';

// send-project-export (verify_jwt = true)
//
// End-of-day email with the project's spreadsheet attached. A SEPARATE email from the daily
// report, with the same recipients (the project's saved list, max 25) and the same send time,
// timezone and 2-hour window. Per-project switch: project_report_settings.export_email_enabled
// (default OFF). Skipped when the project has no tasks.
//
//  - Cron mode (service-role token; pg_cron every 15 min).
//  - Test mode (user JWT, body { projectId }): company admin/PM only; sends to the caller's LOGIN
//    email only; 5 test sends per project per hour.
//
// Resend's batch endpoint does not accept attachments, so each recipient gets an individual
// request with its own Idempotency-Key (a retry can never send that recipient a second copy).

const TEST_SENDS_PER_PROJECT_PER_HOUR = 5;

type SendOutcome = { status: 'sent' } | { status: 'rejected'; error: string } | { status: 'ambiguous'; error: string };

async function sendOne(to: string, subject: string, html: string, filename: string, base64: string, idempotencyKey: string): Promise<SendOutcome> {
  const body = JSON.stringify({ from: FROM, to, subject, html, attachments: [{ filename, content: base64 }] });
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return { status: 'sent' };
      const text = await res.text().catch(() => '');
      lastError = `Resend ${res.status}: ${text.slice(0, 300)}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 409) return { status: 'rejected', error: lastError };
    } catch (e: any) {
      lastError = `Resend request failed: ${e?.message ?? e}`;
    }
    if (attempt === 1) await sleep(1500);
  }
  return { status: 'ambiguous', error: lastError };
}

function emailHtml(projectName: string, dateLabel: string, c: ExportCounts, isTest: boolean) {
  const stat = (label: string, n: number) =>
    `<td style="padding:10px 14px;background:#111827;border-radius:8px;text-align:center;">
       <div style="font-size:20px;font-weight:700;color:#FFFFFF;">${n}</div>
       <div style="font-size:12px;color:#9CA3AF;">${esc(label)}</div></td>`;
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
      <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
      <p style="color:#6B7280;font-size:13px;margin:0 0 24px 0;">${isTest ? 'PROJECT SPREADSHEET (TEST SEND)' : 'PROJECT SPREADSHEET'}</p>
      <h2 style="font-size:20px;color:#FFFFFF;margin:0 0 4px 0;">${esc(projectName)}</h2>
      <p style="font-size:14px;color:#D1D5DB;margin:0 0 20px 0;">${esc(dateLabel)}</p>
      <table style="border-collapse:separate;border-spacing:8px 0;margin-left:-8px;"><tr>
        ${stat('Open', c.open)}${stat('In Progress', c.in_progress)}${stat('Done', c.done)}
      </tr></table>
      <p style="font-size:13px;color:#D1D5DB;margin:20px 0 0 0;">The current task spreadsheet for this project is attached.</p>
      <p style="color:#6B7280;font-size:12px;margin-top:24px;">
        ${isTest ? 'This is a test send to you only.' : 'You are receiving this because you are on the report list for this project. Project admins and managers can change recipients in the project settings.'}
      </p>
    </div>`;
}

async function buildAttachment(admin: SupabaseClient, projectId: string, timeZone: string, when: Date) {
  const data = await loadExportData(admin, projectId);
  if (!data) return null;
  const { workbook, counts } = buildWorkbook(ExcelJS, data);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const localDate = localDateOf(when, timeZone);
  return { data, counts, base64: toBase64(bytes), filename: exportFileName(data.project.name, localDate), localDate };
}

async function runCron(admin: SupabaseClient) {
  const now = new Date();
  const summary = {
    success: true, mode: 'cron', projects_processed: 0, projects_sent: 0, emails_sent: 0,
    projects_skipped: { no_tasks: 0, no_recipients: 0, already_sent: 0, outside_window: 0, not_due: 0, archived: 0 },
    recipients_skipped_no_email: 0,
    failures: [] as { project_id: string; error: string }[],
  };

  const { data: settings, error } = await admin
    .from('project_report_settings')
    .select('project_id, send_time, timezone, export_enabled_at, export_last_sent_date, project:project_id (id, name, archived)')
    .eq('export_email_enabled', true);
  if (error) throw error;

  for (const s of (settings ?? []) as any[]) {
    summary.projects_processed++;
    const projectId: string = s.project_id;
    try {
      if (!s.project || s.project.archived) { summary.projects_skipped.archived++; continue; }
      const enabledAt = s.export_enabled_at ? new Date(s.export_enabled_at) : new Date(0);
      const due = evaluateDue(now, s.send_time, s.timezone, enabledAt, s.export_last_sent_date);
      if (due.state !== 'due') { summary.projects_skipped[due.state]++; continue; }

      // Claim this scheduled day (compare-and-set on export_last_sent_date).
      let claim = admin.from('project_report_settings').update({ export_last_sent_date: due.scheduledDate })
        .eq('project_id', projectId).eq('export_email_enabled', true);
      claim = s.export_last_sent_date ? claim.eq('export_last_sent_date', s.export_last_sent_date) : claim.is('export_last_sent_date', null);
      const { data: claimed, error: claimError } = await claim.select('project_id');
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) { summary.projects_skipped.already_sent++; continue; }
      const release = async () => {
        await admin.from('project_report_settings').update({ export_last_sent_date: s.export_last_sent_date })
          .eq('project_id', projectId).eq('export_last_sent_date', due.scheduledDate);
      };

      const att = await buildAttachment(admin, projectId, s.timezone, now);
      if (!att) { summary.projects_skipped.archived++; continue; }
      if (att.counts.total === 0) { summary.projects_skipped.no_tasks++; continue; }   // day handled, nothing sent

      const { recipients, skippedNoEmail } = await resolveRecipients(admin, projectId);
      summary.recipients_skipped_no_email += skippedNoEmail;
      if (recipients.length === 0) { await release(); summary.projects_skipped.no_recipients++; continue; }

      const dateLabel = formatLocalDate(due.scheduledAt, s.timezone);
      const subject = `Project spreadsheet: ${att.data.project.name} - ${dateLabel}`;
      const html = emailHtml(att.data.project.name, dateLabel, att.counts, false);

      let sent = 0, rejected = 0, ambiguous = 0;
      for (const r of recipients as Recipient[]) {
        const out = await sendOne(r.email, subject, html, att.filename, att.base64,
          `project-export/${projectId}/${due.scheduledDate}/${r.email.toLowerCase()}`);
        if (out.status === 'sent') sent++;
        else if (out.status === 'rejected') { rejected++; summary.failures.push({ project_id: projectId, error: out.error }); }
        else { ambiguous++; summary.failures.push({ project_id: projectId, error: `delivery uncertain: ${out.error}` }); }
        await sleep(600); // Resend default rate limit
      }
      // Nothing delivered and nothing uncertain: release so the next tick in the window retries.
      // Any delivered or uncertain recipient: keep the claim, so nobody gets a second copy.
      if (sent === 0 && ambiguous === 0) { await release(); continue; }
      await admin.from('project_report_settings').update({ export_last_sent_at: new Date().toISOString() }).eq('project_id', projectId);
      summary.projects_sent++;
      summary.emails_sent += sent;
    } catch (e: any) {
      console.error(`Project ${projectId}: spreadsheet email failed:`, e?.message ?? e);
      summary.failures.push({ project_id: projectId, error: e?.message ?? String(e) });
    }
  }
  return summary;
}

async function runTest(admin: SupabaseClient, token: string, projectId: unknown) {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return json({ success: false, error: 'Not authenticated' }, 401);
  const user = userData.user;
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return json({ success: false, error: 'projectId is required' }, 400);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data: canManage, error: rpcError } = await asUser.rpc('can_manage_project_reports', { p_project_id: projectId });
  if (rpcError) throw rpcError;
  if (canManage !== true) return json({ success: false, error: 'Only company admins and project managers can send a test spreadsheet for this project' }, 403);

  const email = (user.email ?? '').trim();
  if (!email) return json({ success: false, error: 'Your login has no email address' }, 400);

  const { data: settings } = await admin.from('project_report_settings').select('timezone').eq('project_id', projectId).maybeSingle();
  const timeZone = settings?.timezone ?? 'America/Chicago';

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const { data: recent, error: recentError } = await admin.from('project_export_test_sends').select('created_at')
    .eq('project_id', projectId).gte('created_at', hourAgo.toISOString()).order('created_at', { ascending: true });
  if (recentError) throw recentError;
  if ((recent ?? []).length >= TEST_SENDS_PER_PROJECT_PER_HOUR) {
    const retryAt = new Date(new Date(recent![0].created_at).getTime() + 3600 * 1000);
    return json({ success: false, error: `Test send limit reached (${TEST_SENDS_PER_PROJECT_PER_HOUR} per project per hour). Try again after ${retryAt.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })}.` }, 429);
  }

  const att = await buildAttachment(admin, projectId, timeZone, new Date());
  if (!att) return json({ success: false, error: 'Project not found' }, 404);

  const { data: logRow, error: logError } = await admin.from('project_export_test_sends')
    .insert({ project_id: projectId, requested_by: user.id, sent_to: email }).select('id').single();
  if (logError) throw logError;

  const dateLabel = formatLocalDate(new Date(), timeZone);
  const out = await sendOne(email, `[Test] Project spreadsheet: ${att.data.project.name} - ${dateLabel}`,
    emailHtml(att.data.project.name, dateLabel, att.counts, true), att.filename, att.base64, `project-export-test/${logRow.id}`);
  if (out.status !== 'sent') {
    await admin.from('project_export_test_sends').update({ status: 'failed', error: out.error.slice(0, 500) }).eq('id', logRow.id);
    return json({ success: false, error: out.error }, 502);
  }
  await admin.from('project_export_test_sends').update({ status: 'sent' }).eq('id', logRow.id);
  return json({ success: true, mode: 'test', sent_to: email, counts: att.counts, tasks_total: att.counts.total });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = bearer(req);
    if (!token) return json({ success: false, error: 'Not authenticated' }, 401);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
    if (isServiceRole(token)) return json(await runCron(admin));
    const body = await req.json().catch(() => ({}));
    return await runTest(admin, token, (body as any)?.projectId);
  } catch (e: any) {
    console.error('send-project-export error:', e?.message ?? e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' }, 500);
  }
});
