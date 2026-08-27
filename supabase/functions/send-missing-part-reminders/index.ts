import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function daysMissing(missingSince: string | null): number {
  if (!missingSince) return 0;
  const ms = Date.now() - new Date(missingSince).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function buildEmailHtml(pmName: string, itemsByProject: Map<string, { title: string; item_text: string; days: number }[]>) {
  const projectBlocks = Array.from(itemsByProject.entries()).map(([projectName, items]) => `
    <h3 style="font-size:15px;color:#FFFFFF;margin:20px 0 10px 0;">${projectName}</h3>
    <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:10px;overflow:hidden;margin-bottom:8px;">
      <thead>
        <tr style="background:#1F2937;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#9CA3AF;">Task</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#9CA3AF;">Missing Part</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#9CA3AF;">Days Missing</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((i) => `
          <tr>
            <td style="padding:8px 12px;border-top:1px solid #1F2937;font-size:13px;color:#E5E7EB;">${i.title}</td>
            <td style="padding:8px 12px;border-top:1px solid #1F2937;font-size:13px;color:#FCA5A5;">${i.item_text}</td>
            <td style="padding:8px 12px;border-top:1px solid #1F2937;font-size:13px;color:#FCA5A5;text-align:right;">${i.days}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
      <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
      <p style="color:#6B7280;font-size:13px;margin-bottom:32px;">MISSING PARTS REMINDER</p>
      <p style="font-size:14px;color:#D1D5DB;margin-bottom:8px;">Hi ${pmName},</p>
      <p style="font-size:14px;color:#D1D5DB;margin-bottom:24px;">The following checklist items are still marked "Don't Have Part" across your projects:</p>
      ${projectBlocks}
      <p style="color:#6B7280;font-size:12px;margin-top:24px;">You'll keep getting this reminder twice a day until each item is marked "Now Have Part" or "Done".</p>
    </div>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const currentHour = centralTime.getHours();
    const currentMinute = centralTime.getMinutes();

    console.log(`Checking schedule at Central Time: Hour=${currentHour} Minute=${currentMinute}`);

    // Fixed schedule: 8:00 AM and 4:00 PM Central. Cron fires every 15 min,
    // so a 14-minute window keeps this from firing twice per target hour.
    const inWindow = (currentHour === 8 || currentHour === 16) && currentMinute <= 14;
    if (!inWindow) {
      return new Response(JSON.stringify({ skipped: true, reason: 'outside reminder window' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: items, error: itemsError } = await supabaseAdmin
      .from('checklist_items')
      .select('id, item_text, missing_since, task:task_id (id, title, project_id, project:project_id (id, name, created_by))')
      .eq('status', 'missing_part');

    if (itemsError) throw itemsError;

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ success: true, pms_notified: 0, items_notified: 0, items_skipped_no_pm: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const projectIds = [...new Set(items.map((i: any) => i.task?.project_id).filter(Boolean))];

    // --- Per-project PMs (existing lookup): project_members joined to company_members role='project_manager' ---
    const { data: members, error: membersError } = await supabaseAdmin
      .from('project_members')
      .select('project_id, user_id')
      .in('project_id', projectIds.length > 0 ? projectIds : ['00000000-0000-0000-0000-000000000000']);
    if (membersError) throw membersError;

    const candidateUserIds = [...new Set((members ?? []).map((m: any) => m.user_id))];

    const { data: companyMembers, error: companyMembersError } = await supabaseAdmin
      .from('company_members')
      .select('user_id, role')
      .in('user_id', candidateUserIds.length > 0 ? candidateUserIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('role', 'project_manager');
    if (companyMembersError) throw companyMembersError;

    const pmUserIds = new Set((companyMembers ?? []).map((m: any) => m.user_id));

    // project_id -> Set of PM user_ids assigned to that project
    const projectRecipientMap = new Map<string, Set<string>>();
    for (const m of members ?? []) {
      if (!pmUserIds.has(m.user_id)) continue;
      if (!projectRecipientMap.has(m.project_id)) projectRecipientMap.set(m.project_id, new Set());
      projectRecipientMap.get(m.project_id)!.add(m.user_id);
    }

    // --- Company-wide admins: every company_members role='admin' for the company that owns each
    // project, regardless of whether they're a project_members row on that project. "The company
    // that owns a project" = the creator's company (projects has no company_id of its own). ---
    const creatorIds = [...new Set(
      (items as any[]).map((i) => i.task?.project?.created_by).filter(Boolean)
    )];

    const { data: creatorProfiles, error: creatorProfilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, company_id')
      .in('id', creatorIds.length > 0 ? creatorIds : ['00000000-0000-0000-0000-000000000000']);
    if (creatorProfilesError) throw creatorProfilesError;

    const companyIdByCreator = new Map((creatorProfiles ?? []).map((p: any) => [p.id, p.company_id]));

    // project_id -> company_id (via that project's creator)
    const companyIdByProject = new Map<string, string>();
    for (const item of items as any[]) {
      const projectId = item.task?.project_id;
      const creatorId = item.task?.project?.created_by;
      const companyId = creatorId ? companyIdByCreator.get(creatorId) : null;
      if (projectId && companyId) companyIdByProject.set(projectId, companyId);
    }

    const distinctCompanyIds = [...new Set(companyIdByProject.values())];

    const { data: companyAdmins, error: companyAdminsError } = await supabaseAdmin
      .from('company_members')
      .select('user_id, company_id')
      .in('company_id', distinctCompanyIds.length > 0 ? distinctCompanyIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('role', 'admin');
    if (companyAdminsError) throw companyAdminsError;

    // company_id -> Set of admin user_ids
    const adminsByCompany = new Map<string, Set<string>>();
    for (const a of companyAdmins ?? []) {
      if (!adminsByCompany.has(a.company_id)) adminsByCompany.set(a.company_id, new Set());
      adminsByCompany.get(a.company_id)!.add(a.user_id);
    }

    // Merge company-wide admins into each project's recipient set (Set union naturally dedupes by user_id).
    for (const projectId of projectIds) {
      const companyId = companyIdByProject.get(projectId);
      const adminIds = companyId ? adminsByCompany.get(companyId) : undefined;
      if (!adminIds || adminIds.size === 0) continue;
      if (!projectRecipientMap.has(projectId)) projectRecipientMap.set(projectId, new Set());
      const recipientSet = projectRecipientMap.get(projectId)!;
      for (const adminId of adminIds) recipientSet.add(adminId);
    }

    const allRecipientUserIds = [...new Set([...projectRecipientMap.values()].flatMap((s) => [...s]))];

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', allRecipientUserIds.length > 0 ? allRecipientUserIds : ['00000000-0000-0000-0000-000000000000']);
    if (profilesError) throw profilesError;

    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // recipient user_id -> project name -> item rows
    const recipientData = new Map<string, Map<string, { title: string; item_text: string; days: number }[]>>();
    const notifiedItemIds: string[] = [];
    let itemsSkippedNoPm = 0;

    for (const item of items as any[]) {
      const projectId = item.task?.project_id;
      const projectName = item.task?.project?.name ?? 'Unknown Project';
      const taskTitle = item.task?.title ?? 'Unknown Task';
      const recipientIds = projectId ? projectRecipientMap.get(projectId) : undefined;

      if (!recipientIds || recipientIds.size === 0) {
        itemsSkippedNoPm++;
        continue;
      }

      for (const recipientId of recipientIds) {
        if (!recipientData.has(recipientId)) recipientData.set(recipientId, new Map());
        const byProject = recipientData.get(recipientId)!;
        if (!byProject.has(projectName)) byProject.set(projectName, []);
        byProject.get(projectName)!.push({
          title: taskTitle,
          item_text: item.item_text,
          days: daysMissing(item.missing_since),
        });
      }

      notifiedItemIds.push(item.id);
    }

    // Final dedupe by email — recipientData is already keyed by user_id (so an admin who is
    // also a project PM only ever gets one entry via Set union above), but this collapses
    // by email too in case two different user_ids ever resolve to the same address.
    const dataByEmail = new Map<string, { email: string; name: string; byProject: Map<string, { title: string; item_text: string; days: number }[]> }>();
    for (const [recipientId, byProject] of recipientData) {
      const profile = profileById.get(recipientId);
      if (!profile?.email) continue;
      const emailKey = profile.email.toLowerCase();

      if (!dataByEmail.has(emailKey)) {
        dataByEmail.set(emailKey, { email: profile.email, name: profile.full_name ?? 'there', byProject: new Map() });
      }
      const entry = dataByEmail.get(emailKey)!;
      for (const [projectName, rows] of byProject) {
        if (!entry.byProject.has(projectName)) entry.byProject.set(projectName, []);
        entry.byProject.get(projectName)!.push(...rows);
      }
    }

    let pmsNotified = 0;

    for (const { email, name, byProject } of dataByEmail.values()) {
      const html = buildEmailHtml(name, byProject);

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'FieldOps Pro <noreply@mail.fieldopspro.org>',
          to: email,
          subject: 'Missing Parts Reminder',
          html,
        }),
      });

      if (!emailRes.ok) {
        const errBody = await emailRes.json().catch(() => ({}));
        console.error(`Failed to send reminder to ${email}:`, JSON.stringify(errBody));
        continue;
      }

      pmsNotified++;
    }

    if (notifiedItemIds.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('checklist_items')
        .update({ last_notified_at: new Date().toISOString() })
        .in('id', notifiedItemIds);
      if (updateError) console.error('Failed to update last_notified_at:', updateError.message);
    }

    return new Response(JSON.stringify({
      success: true,
      pms_notified: pmsNotified,
      items_notified: notifiedItemIds.length,
      items_skipped_no_pm: itemsSkippedNoPm,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('send-missing-part-reminders error:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
