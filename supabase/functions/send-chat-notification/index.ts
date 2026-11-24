import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decodes the role claim from a Supabase JWT without verifying its signature —
// the API gateway's verify_jwt=true already guarantees the token is validly
// signed before this function ever runs; this only reads the claim.
// NOTE: this assumes the legacy HS256 service-role JWT format, which encodes
// `role: "service_role"` as a base64url JWT segment. If the project's service
// role key is ever rotated to the new sb_secret_... key format, this check
// must be updated — that format is not a JWT and has no role claim to decode
// this way.
function getJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // This function is only ever invoked by the notify_chat_message() Postgres
  // trigger on messages insert, which calls it with the service_role key.
  // Reject anything else (a user session token, the anon key, etc.) — there is
  // no legitimate caller besides that trigger.
  const callerToken = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  if (getJwtRole(callerToken) !== 'service_role') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { record } = await req.json();
    const { id: messageId, project_id, user_id, body, photo_url } = record;

    if (!project_id || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get project name and sender name
    const [projectRes, senderRes] = await Promise.all([
      supabase.from('projects').select('name').eq('id', project_id).single(),
      supabase.from('profiles').select('full_name').eq('id', user_id).single(),
    ]);

    const projectName = projectRes.data?.name ?? 'Project';
    const senderName = senderRes.data?.full_name ?? 'Someone';
    const messageBody = photo_url ? '📷 Photo' : body;

    // Get all project members except the sender with push tokens
    const { data: members } = await supabase
      .from('project_members')
      .select('user_id, profiles!user_id(push_token)')
      .eq('project_id', project_id)
      .neq('user_id', user_id);

    const pushTokens = (members ?? [])
      .map((m: any) => m.profiles?.push_token)
      .filter(Boolean);

    if (pushTokens.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send push notifications
    const messages = pushTokens.map((token: string) => ({
      to: token,
      sound: 'default',
      title: `💬 ${projectName}`,
      body: `${senderName}: ${messageBody}`,
      data: { type: 'chat', projectId: project_id, messageId },
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

    return new Response(JSON.stringify({ success: true, sent: pushTokens.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});