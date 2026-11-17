// Shared helpers for build-project-export and send-project-export.
// verifiedJwtRole and resolveRecipients are copied from send-daily-reports (unchanged logic).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'content-disposition',
};

export const FROM = 'FieldOps Pro <noreply@mail.fieldopspro.org>';
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

// Reads the `role` claim from a JWT payload WITHOUT verifying the signature.
//
// SECURITY: only safe because every function using it is deployed with verify_jwt = true
// (see supabase/config.toml). The Supabase gateway verifies the signature and rejects invalid
// or forged tokens with a 401 before this code runs. If verify_jwt is ever turned off for a
// function, this check becomes forgeable and MUST be replaced with real verification.
//
// Never log the token or any part of it.
export function verifiedJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims = JSON.parse(atob(b64));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

export function isServiceRole(token: string): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return (!!serviceKey && token === serviceKey) || verifiedJwtRole(token) === 'service_role';
}

export type Recipient = { email: string };

// Same rule as the daily report: the project's saved recipient list (max 25). Team members
// resolve to profiles.email at send time; external entries use the stored address. Deduped by
// lower-cased address. Team members with no email on file are skipped and counted.
// deno-lint-ignore no-explicit-any
export async function resolveRecipients(admin: any, projectId: string): Promise<{ recipients: Recipient[]; skippedNoEmail: number }> {
  const { data: rows, error } = await admin.from('project_report_recipients').select('user_id, email').eq('project_id', projectId);
  if (error) throw error;
  const userIds = (rows ?? []).map((r: any) => r.user_id).filter(Boolean);
  const { data: profiles, error: profilesError } = await admin
    .from('profiles').select('id, email').in('id', userIds.length > 0 ? userIds : [NIL_UUID]);
  if (profilesError) throw profilesError;
  const emailByUser = new Map((profiles ?? []).map((p: any) => [p.id, p.email as string | null]));

  const byEmail = new Map<string, Recipient>();
  let skippedNoEmail = 0;
  for (const r of rows ?? []) {
    let email: string | null;
    if (r.user_id) {
      email = emailByUser.get(r.user_id)?.trim() || null;
      if (!email) { skippedNoEmail++; console.log(`Project ${projectId}: skipping recipient user ${r.user_id}, no email on file`); continue; }
    } else {
      email = r.email?.trim() || null;
    }
    if (email && !byEmail.has(email.toLowerCase())) byEmail.set(email.toLowerCase(), { email });
  }
  return { recipients: [...byEmail.values()], skippedNoEmail };
}

// base64 for Resend attachments (chunked so large files do not overflow the call stack)
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
