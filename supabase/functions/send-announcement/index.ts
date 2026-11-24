import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify the caller from their own session token — never trust a
    // client-supplied "createdBy" field for who is sending this.
    const callerToken = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user }, error: authError } = await supabase.auth.getUser(callerToken);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    console.log('Request body:', JSON.stringify(body));

    const { projectId, title, message } = body;

    if (!projectId || !title || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get project info
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('name, created_by')
      .eq('id', projectId)
      .single();

    console.log('Project result:', JSON.stringify(project), 'Error:', JSON.stringify(projectError));

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found', detail: projectError?.message }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve the project's company via its creator's profile — the projects
    // table has no company_id column of its own.
    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', project.created_by)
      .single();

    const companyId = creatorProfile?.company_id;

    // Authorization: the caller must be EITHER a project member whose company
    // role is admin or project_manager, OR an admin of the project's company
    // outright. Admins aren't always rows in project_members — only people
    // explicitly invited to a project get one — so an admin managing a
    // project they didn't create or get personally invited to must still be
    // let through.
    // A user can have company_members rows in more than one company (e.g.
    // admin in one, worker in another), so these checks look for "any
    // matching row" across the full set — never .single()/.maybeSingle() on
    // the membership alone.
    const [{ data: callerCompanyRoles }, { data: callerProjectRows }] = await Promise.all([
      supabase.from('company_members').select('company_id, role').eq('user_id', user.id),
      supabase.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', user.id),
    ]);

    const isCompanyAdmin = (callerCompanyRoles ?? []).some(
      (r) => r.company_id === companyId && r.role === 'admin'
    );
    const isCompanyAdminOrPM = (callerCompanyRoles ?? []).some(
      (r) => r.company_id === companyId && (r.role === 'admin' || r.role === 'project_manager')
    );
    const isProjectMember = (callerProjectRows ?? []).length > 0;

    if (!isCompanyAdmin && !(isProjectMember && isCompanyAdminOrPM)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const createdBy = user.id;

    // Save announcement to announcements table
    const { error: insertError } = await supabase
      .from('announcements')
      .insert({
        project_id: projectId,
        company_id: companyId,
        title,
        message,
        created_by: createdBy,
      });

    if (insertError) {
      console.log('Insert error:', JSON.stringify(insertError));
      throw insertError;
    }

    // Get all project members except the sender
    const { data: members } = await supabase
      .from('project_members')
      .select('user_id, profiles!user_id(push_token, full_name)')
      .eq('project_id', projectId)
      .neq('user_id', createdBy);

    console.log('Members found:', members?.length ?? 0);

    const memberList = members ?? [];

    // Insert into notifications table so it appears in the bell
    const notificationRows = memberList.map((m: any) => ({
      user_id: m.user_id,
      project_id: projectId,
      title: `📢 Announcement — ${project.name}`,
      body: `${title}: ${message}`,
      read: false,
    }));

    if (notificationRows.length > 0) {
      const { error: notifError } = await supabase.from('notifications').insert(notificationRows);
      if (notifError) console.log('Notification insert error:', JSON.stringify(notifError));
    }

    // Send push notifications via Expo
    const pushTokens = memberList
      .map((m: any) => m.profiles?.push_token)
      .filter(Boolean);

    console.log('Push tokens found:', pushTokens.length);

    if (pushTokens.length > 0) {
      const messages = pushTokens.map((token: string) => ({
        to: token,
        sound: 'default',
        title: `📢 ${project.name}`,
        body: `${title}: ${message}`,
        data: { type: 'announcement', projectId },
      }));

      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
    }

    return new Response(JSON.stringify({ success: true, sent: pushTokens.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.log('Caught error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});