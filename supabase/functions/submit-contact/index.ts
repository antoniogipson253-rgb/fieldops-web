import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { esc, FROM } from '../_shared/common.ts';

// submit-contact (verify_jwt = false -- public, unauthenticated form on the landing page).
// PREPARED, NOT DEPLOYED. Deploying this later needs --no-verify-jwt (config.toml alone is
// not enough -- see MIGRATIONS.md's deploy notes elsewhere in this project).
//
// Order of operations, deliberately: insert the row FIRST, then attempt the email. A visitor
// who submits always gets their row stored even if Resend is down; the email is best-effort
// on top of that, never a precondition for "did this submission survive."
//
// Never logs message bodies or email addresses. Never echoes user input back in a response.

const ALLOWED_ORIGINS = [
  'https://www.fieldopspro.org',
  'https://fieldopspro.org',
];
// TODO tighten before general launch: drops the *.netlify.app allowance once the custom
// domain is the only place this form is exercised from.
const NETLIFY_SUFFIX = '.netlify.app';

// Exported for tests. A malformed Origin header (not a parseable URL) must never throw --
// it just isn't an allowed origin.
export function corsHeadersFor(origin: string | null): Record<string, string> {
  let allowed = false;
  if (origin) {
    if (ALLOWED_ORIGINS.includes(origin)) {
      allowed = true;
    } else {
      try {
        allowed = new URL(origin).hostname.endsWith(NETLIFY_SUFFIX);
      } catch {
        allowed = false;
      }
    }
  }
  return {
    'Access-Control-Allow-Origin': allowed ? origin! : 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_PER_HOUR = 5;
const DAILY_EMAIL_CAP = 30;
const MIN_FILL_TIME_MS = 3000;
const GLOBAL_HOURLY_CAP = 200;

export type ContactPayload = {
  kind: string; name: string; email: string; company: string; phone: string; message: string;
};

// Pure validation, no I/O -- unit-testable in isolation. Returns the trimmed, length-capped
// fields on success, or null on any rejection (caller returns a generic 400, no detail).
// deno-lint-ignore no-explicit-any
export function validateContact(body: any): ContactPayload | null {
  if (!body || typeof body !== 'object') return null;
  const kind = body.kind;
  if (kind !== 'call' && kind !== 'feedback') return null;

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 100) return null;

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (email.length === 0 || email.length > 200 || !EMAIL_RE.test(email)) return null;

  const company = typeof body.company === 'string' ? body.company.trim() : '';
  if (company.length > 150) return null;

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (phone.length > 40) return null;

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > 2000) return null;
  if (kind === 'feedback' && message.length === 0) return null;

  return { kind, name, email, company, phone, message };
}

// Newlines stripped so a crafted field can't inject extra header-like lines into the subject.
export function stripNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildSubject(p: ContactPayload): string {
  const kindLabel = p.kind === 'call' ? 'call request' : 'feedback';
  return `FieldOps landing ${kindLabel}: ${stripNewlines(p.name)} <${stripNewlines(p.email)}>`.slice(0, 200);
}

export function buildEmailHtml(p: ContactPayload): string {
  const rows: Array<[string, string]> = [
    ['Type', p.kind === 'call' ? 'Request a call' : 'Share feedback'],
    ['Name', p.name],
    ['Email', p.email],
  ];
  if (p.company) rows.push(['Company', p.company]);
  if (p.phone) rows.push(['Phone', p.phone]);
  const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#9CA3AF;">${esc(k)}</td><td style="padding:4px 0;color:#F9FAFB;">${esc(v)}</td></tr>`).join('');
  const messageHtml = p.message
    ? `<p style="margin-top:16px;color:#F9FAFB;white-space:pre-wrap;">${esc(p.message)}</p>`
    : '<p style="margin-top:16px;color:#9CA3AF;">(no message)</p>';
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0A0F1E;color:#F9FAFB;border-radius:12px;">
      <h2 style="color:#F97316;font-size:16px;letter-spacing:2px;margin:0 0 16px 0;">FIELDOPS LANDING PAGE</h2>
      <table style="border-collapse:collapse;font-size:14px;">${rowsHtml}</table>
      ${messageHtml}
    </div>`;
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode('fieldops-landing-v1:' + ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// Pure, exported for tests. A missing, non-numeric, or non-finite loadedAt is treated the
// same as a too-fast submission: both mean "not a real human filling out the form."
export function isLikelyAutomated(loadedAt: unknown, now: number = Date.now()): boolean {
  if (typeof loadedAt !== 'number' || !Number.isFinite(loadedAt)) return true;
  return now - loadedAt < MIN_FILL_TIME_MS;
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const cors = corsHeadersFor(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ success: false }, 405, cors);

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ success: false }, 400, cors);
    }
    const b = body as Record<string, unknown>;

    // Honeypot: a real visitor never fills this in (it's visually hidden and tabindex="-1").
    if (typeof b.website === 'string' && b.website.length > 0) {
      return json({ success: true }, 200, cors);
    }

    // Minimum fill time, including a missing/non-numeric timestamp -- both are treated as
    // automated: the client sends Date.now() at page load, and a real browser always sends a
    // number.
    if (isLikelyAutomated(b.loadedAt)) {
      return json({ success: true }, 200, cors);
    }

    const payload = validateContact(b);
    if (!payload) return json({ success: false }, 400, cors);

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });

    const ip = clientIp(req);
    const ipHash = await hashIp(ip);

    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();

    // Global backstop: regardless of per-IP behavior, a sustained flood is treated as
    // automated and nothing is stored.
    const { count: globalRecentCount, error: globalRateError } = await admin
      .from('landing_inquiries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', hourAgo);
    if (globalRateError) throw globalRateError;
    if ((globalRecentCount ?? 0) > GLOBAL_HOURLY_CAP) {
      return json({ success: true }, 200, cors);
    }

    const { count: recentCount, error: rateError } = await admin
      .from('landing_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', hourAgo);
    if (rateError) throw rateError;
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ success: true }, 200, cors);
    }

    const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500);

    const { data: inserted, error: insertError } = await admin
      .from('landing_inquiries')
      .insert({
        kind: payload.kind,
        name: payload.name,
        email: payload.email,
        company: payload.company || null,
        phone: payload.phone || null,
        message: payload.message || null,
        ip_hash: ipHash,
        user_agent: userAgent || null,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    // Global daily email cap: the row above is already stored regardless of what happens next.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: sentToday, error: capError } = await admin
      .from('landing_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('email_sent', true)
      .gte('created_at', todayStart.toISOString());
    if (capError) throw capError;
    if ((sentToday ?? 0) >= DAILY_EMAIL_CAP) {
      return json({ success: true }, 200, cors);
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `landing-inquiry/${inserted.id}`,
        },
        body: JSON.stringify({
          from: FROM,
          to: 'fieldops.pro1@gmail.com',
          'reply_to': payload.email,
          subject: buildSubject(payload),
          html: buildEmailHtml(payload),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        await admin.from('landing_inquiries').update({ email_sent: true }).eq('id', inserted.id);
      } else {
        console.error(`landing inquiry ${inserted.id}: Resend responded ${res.status}`);
      }
    } catch (e) {
      console.error(`landing inquiry ${inserted.id}: Resend request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Visitor always gets success once the row is stored, regardless of email outcome.
    return json({ success: true }, 200, cors);
  } catch (e) {
    // Never leak error details to the visitor; corsHeadersFor() already succeeded above, so
    // this response still carries correct CORS headers.
    console.error(`submit-contact: unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return json({ success: false }, 500, cors);
  }
}

// import.meta.main is false when this module is imported by the test file, so the test run
// never actually opens a listening socket.
if (import.meta.main) Deno.serve(handle);
