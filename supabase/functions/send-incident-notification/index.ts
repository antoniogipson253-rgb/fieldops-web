import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const severityColors: Record<string, string> = {
  low: '#1D9E75',
  medium: '#EF9F27',
  high: '#E24B4A',
  critical: '#7C3AED',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Email subject lines are plain text, not HTML — escapeHtml would make
// entities (e.g. &amp;) show up literally. A subject only needs newline and
// other control characters stripped, since those could otherwise inject
// extra header lines.
function stripControlChars(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t\x00-\x1F\x7F]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify the caller from their own session token — never trust a
    // client-supplied "reportedBy" field for who is reporting this.
    const callerToken = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user }, error: authError } = await supabase.auth.getUser(callerToken);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { companyId, incidentType, severity, description, location, injuredPerson } = body;

    if (!companyId) {
      return new Response(JSON.stringify({ error: 'Missing companyId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Authorization: the caller must be a member of the company they're
    // reporting an incident for. A user can have company_members rows in more
    // than one company, so this checks "any matching row", never
    // .single()/.maybeSingle() on the membership alone.
    const { data: callerCompanyRows } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', user.id);

    const isCallerCompanyMember = (callerCompanyRows ?? []).some((r) => r.company_id === companyId);
    if (!isCallerCompanyMember) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // reportedBy is derived from the verified caller, never trusted from the body.
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    const reportedBy = callerProfile?.full_name ?? 'Unknown';

    // Get admin emails for this company
    const { data: admins } = await supabase
      .from('company_members')
      .select('user_id, profiles!user_id(email, full_name)')
      .eq('company_id', companyId)
      .eq('role', 'admin');

    const adminEmails = (admins ?? [])
      .map((a: any) => a.profiles?.email)
      .filter(Boolean);

    if (adminEmails.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No admin emails found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const color = severityColors[severity] ?? '#6B7280';
    const now = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FieldOps Safety <noreply@mail.fieldopspro.org>',
        to: adminEmails,
        subject: `[${stripControlChars(severity?.toUpperCase())}] Safety Incident Reported — ${stripControlChars(incidentType)}`,
        html: `
          <div style="font-family: sans-serif; background: #0A0F1E; color: #FFFFFF; padding: 32px; border-radius: 12px; max-width: 600px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
              <div style="width: 12px; height: 12px; border-radius: 6px; background: ${color};"></div>
              <h1 style="color: #FFFFFF; margin: 0; font-size: 20px;">Safety Incident Report</h1>
            </div>

            <div style="background: ${color}20; border: 1px solid ${color}; border-radius: 10px; padding: 16px; margin-bottom: 24px;">
              <div style="font-size: 13px; font-weight: 700; color: ${color}; letter-spacing: 2px; margin-bottom: 8px;">
                ${escapeHtml(severity?.toUpperCase())} SEVERITY — ${escapeHtml(incidentType)}
              </div>
              <div style="font-size: 13px; color: #9CA3AF;">${now}</div>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <tr style="border-bottom: 1px solid #1F2937;">
                <td style="padding: 12px 0; font-size: 12px; color: #6B7280; font-weight: 700; letter-spacing: 1px; width: 140px;">REPORTED BY</td>
                <td style="padding: 12px 0; font-size: 14px; color: #FFFFFF;">${escapeHtml(reportedBy)}</td>
              </tr>
              ${injuredPerson ? `
              <tr style="border-bottom: 1px solid #1F2937;">
                <td style="padding: 12px 0; font-size: 12px; color: #E24B4A; font-weight: 700; letter-spacing: 1px;">INJURED PERSON</td>
                <td style="padding: 12px 0; font-size: 14px; color: #FFFFFF;">${escapeHtml(injuredPerson)}</td>
              </tr>` : ''}
              ${location ? `
              <tr style="border-bottom: 1px solid #1F2937;">
                <td style="padding: 12px 0; font-size: 12px; color: #6B7280; font-weight: 700; letter-spacing: 1px;">LOCATION</td>
                <td style="padding: 12px 0; font-size: 14px; color: #FFFFFF;">${escapeHtml(location)}</td>
              </tr>` : ''}
            </table>

            <div style="margin-bottom: 24px;">
              <div style="font-size: 12px; color: #6B7280; font-weight: 700; letter-spacing: 2px; margin-bottom: 10px;">DESCRIPTION</div>
              <div style="font-size: 14px; color: #D1D5DB; line-height: 1.6; background: #111827; padding: 16px; border-radius: 8px; border: 1px solid #1F2937;">
                ${escapeHtml(description)}
              </div>
            </div>

            <p style="color: #4B5563; font-size: 12px; margin: 0;">
              Log in to FieldOps Pro to view the full incident report and take action.
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      throw new Error(`Resend error: ${err}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});