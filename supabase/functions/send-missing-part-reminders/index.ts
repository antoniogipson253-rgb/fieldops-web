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
      .select('id, item_text, missing_since, task:task_id (id, title, project_id, project:project_id (id, name))')
      .eq('status', 'missing_part');

    if (itemsError) throw itemsError;

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ success: true, pms_notified: 0, items_notified: 0, items_skipped_no_pm: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const projectIds = [...new Set(items.map((i: any) => i.task?.project_id).filter(Boolean))];

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
    const projectPmMap = new Map<string, Set<string>>();
    for (const m of members ?? []) {
      if (!pmUserIds.has(m.user_id)) continue;
      if (!projectPmMap.has(m.project_id)) projectPmMap.set(m.project_id, new Set());
      projectPmMap.get(m.project_id)!.add(m.user_id);
    }

    const allPmUserIds = [...new Set([...projectPmMap.values()].flatMap((s) => [...s]))];

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', allPmUserIds.length > 0 ? allPmUserIds : ['00000000-0000-0000-0000-000000000000']);
    if (profilesError) throw profilesError;

    const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // pm user_id -> project name -> item rows
    const recipientData = new Map<string, Map<string, { title: string; item_text: string; days: number }[]>>();
    const notifiedItemIds: string[] = [];
    let itemsSkippedNoPm = 0;

    for (const item of items as any[]) {
      const projectId = item.task?.project_id;
      const projectName = item.task?.project?.name ?? 'Unknown Project';
      const taskTitle = item.task?.title ?? 'Unknown Task';
      const pmIds = projectId ? projectPmMap.get(projectId) : undefined;

      if (!pmIds || pmIds.size === 0) {
        itemsSkippedNoPm++;
        continue;
      }

      for (const pmId of pmIds) {
        if (!recipientData.has(pmId)) recipientData.set(pmId, new Map());
        const byProject = recipientData.get(pmId)!;
        if (!byProject.has(projectName)) byProject.set(projectName, []);
        byProject.get(projectName)!.push({
          title: taskTitle,
          item_text: item.item_text,
          days: daysMissing(item.missing_since),
        });
      }

      notifiedItemIds.push(item.id);
    }

    let pmsNotified = 0;

    for (const [pmId, byProject] of recipientData) {
      const profile = profileById.get(pmId);
      if (!profile?.email) continue;

      const html = buildEmailHtml(profile.full_name ?? 'there', byProject);

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'FieldOps Pro <noreply@mail.fieldopspro.org>',
          to: profile.email,
          subject: 'Missing Parts Reminder',
          html,
        }),
      });

      if (!emailRes.ok) {
        const errBody = await emailRes.json().catch(() => ({}));
        console.error(`Failed to send reminder to ${profile.email}:`, JSON.stringify(errBody));
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
