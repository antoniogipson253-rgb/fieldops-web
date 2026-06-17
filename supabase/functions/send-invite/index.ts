import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, invitedBy, companyName, role, projectId, companyId } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const isClient = role === 'client'

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        invited_by: invitedBy,
        company_name: companyName,
        role: role,
        project_id: projectId ?? null,
        company_id: companyId ?? null,
      },
      redirectTo: isClient ? 'https://fieldops-web-mocha.vercel.app/client-portal' : 'https://fieldops-web-mocha.vercel.app/accept-invite',
    })

    if (error) throw error

    // If client, store in invitations with project_id
    if (isClient && projectId && companyId) {
      await supabaseAdmin
        .from('invitations')
        .insert({
          email: email.toLowerCase(),
          invited_by: invitedBy,
          status: 'pending',
          role: 'client',
          company_id: companyId,
          project_id: projectId,
        })
    } else {
      // Regular team member invite
      await supabaseAdmin.rpc('invite_to_company', {
        p_email: email.toLowerCase(),
        p_invited_by: invitedBy,
        p_role: role,
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const subject = isClient
      ? `You've been invited to view a project on FieldOps`
      : `You have been invited to join ${companyName} on FieldOps`

    const bodyHtml = isClient ? `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0A0F1E; color: #FFFFFF; border-radius: 16px;">
        <h1 style="color: #F97316; font-size: 28px; letter-spacing: 4px; margin-bottom: 8px;">FIELDOPS</h1>
        <p style="color: #6B7280; font-size: 13px; margin-bottom: 32px;">CLIENT PORTAL</p>
        <h2 style="font-size: 20px; margin-bottom: 16px;">You've been invited!</h2>
        <p style="color: #9CA3AF; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          <strong style="color: #F97316;">${companyName}</strong> has invited you to view your project updates on FieldOps Pro.
        </p>
        <a href="https://fieldops-web-mocha.vercel.app/client-login" style="display: inline-block; padding: 14px 32px; background: #F97316; color: #FFFFFF; font-weight: 900; font-size: 15px; text-decoration: none; border-radius: 10px; letter-spacing: 2px;">
          VIEW MY PROJECT
        </a>
        <p style="color: #374151; font-size: 12px; margin-top: 32px;">Questions? Email us at fieldops.pro1@gmail.com</p>
      </div>
    ` : `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0A0F1E; color: #FFFFFF; border-radius: 16px;">
        <h1 style="color: #F97316; font-size: 28px; letter-spacing: 4px; margin-bottom: 8px;">FIELDOPS</h1>
        <p style="color: #6B7280; font-size: 13px; margin-bottom: 32px;">PRO DASHBOARD</p>
        <h2 style="font-size: 20px; margin-bottom: 16px;">You have been invited!</h2>
        <p style="color: #9CA3AF; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
          You have been invited to join <strong style="color: #F97316;">${companyName}</strong> on FieldOps as a <strong>${role}</strong>.
        </p>
        <a href="https://fieldops-web-mocha.vercel.app/accept-invite" style="display: inline-block; padding: 14px 32px; background: #F97316; color: #0A0F1E; font-weight: 900; font-size: 15px; text-decoration: none; border-radius: 10px; letter-spacing: 2px;">
          ACCEPT INVITE
        </a>
        <p style="color: #374151; font-size: 12px; margin-top: 32px;">Questions? Email us at fieldops.pro1@gmail.com</p>
      </div>
    `

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FieldOps <fieldops.pro1@gmail.com>',
        to: email,
        subject,
        html: bodyHtml,
      }),
    })

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})