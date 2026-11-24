import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { bearer, esc, UUID_RE } from '../_shared/common.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Require a real, signed-in caller. The anon key alone does not resolve to
    // a user, so it fails here exactly like no token at all.
    const token = bearer(req)
    if (!token) return json({ success: false, error: 'Not authenticated' }, 401)

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // User-scoped client: anon key + the caller's own token, so auth.uid() inside
    // any RPC called through this client is the real caller, not something the
    // request body can claim to be.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ success: false, error: 'Not authenticated' }, 401)

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Rate limit: at most 20 invitations per caller per rolling hour. Uses the
    // service client so this count is accurate regardless of RLS.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentInviteCount, error: rateLimitError } = await supabaseAdmin
      .from('invitations')
      .select('id', { count: 'exact', head: true })
      .eq('invited_by', user.id)
      .gte('created_at', oneHourAgo)
    if (rateLimitError) return json({ success: false, error: rateLimitError.message }, 400)
    if ((recentInviteCount ?? 0) >= 20) {
      return json({ success: false, error: 'Too many invitations. Try again later.' }, 429)
    }

    const { email, role, projectId } = await req.json()
    // invitedBy, companyId, companyName from the body are intentionally never
    // used for authorization below -- authority comes only from the RPC result
    // (or, for client invites, from the caller's own company_members row).

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return json({ success: false, error: 'Invalid email address' }, 400)
    }
    const normalizedEmail = email.toLowerCase().trim()

    if (projectId !== undefined && projectId !== null && !UUID_RE.test(String(projectId))) {
      return json({ success: false, error: 'Invalid projectId' }, 400)
    }

    const isClient = role === 'client'
    let finalCompanyId: string | null = null
    let finalProjectId: string | null = null
    let finalRole: string
    let alreadyHandled = false // true for 'added' / 'already_member' -- no invite email needed
    let insertedInvitationId: string | null = null // client path only -- rolled back if the auth invite fails

    if (isClient) {
      // Neither invite_to_company nor invite_user_to_project models a client
      // invite (role='client', project_id + company_id together, writing
      // client_projects rather than a company/project membership). Authorize
      // this path the same way those RPCs authorize theirs: derive authority
      // from the real caller via the user-scoped client, never from the body.
      if (!projectId) return json({ success: false, error: 'projectId is required for a client invite' }, 400)

      const { data: callerMembership } = await userClient
        .from('company_members')
        .select('company_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!callerMembership || callerMembership.role !== 'admin') {
        return json({ success: false, error: 'Only company admins can invite clients' }, 403)
      }

      // Confirm the project actually belongs to the caller's own company before
      // trusting it (projects has no company_id column; resolved via created_by).
      const { data: project } = await supabaseAdmin
        .from('projects').select('id, created_by').eq('id', projectId).maybeSingle()
      const { data: creatorProfile } = project
        ? await supabaseAdmin.from('profiles').select('company_id').eq('id', project.created_by).maybeSingle()
        : { data: null }

      if (!project || creatorProfile?.company_id !== callerMembership.company_id) {
        return json({ success: false, error: 'Project not found in your company' }, 403)
      }

      finalCompanyId = callerMembership.company_id
      finalProjectId = projectId
      finalRole = 'client'

      const { data: insertedInvitation, error: insertError } = await supabaseAdmin
        .from('invitations')
        .insert({
          email: normalizedEmail,
          invited_by: user.id,
          status: 'pending',
          role: 'client',
          company_id: finalCompanyId,
          project_id: finalProjectId,
        })
        .select('id')
        .single()
      if (insertError) return json({ success: false, error: insertError.message }, 400)
      insertedInvitationId = insertedInvitation.id

    } else if (projectId) {
      const { data: rpcResult, error: rpcError } = await userClient.rpc('invite_user_to_project', {
        p_project_id: projectId,
        p_email: normalizedEmail,
        p_invited_by: user.id, // ignored server-side once 090009 is applied; auth.uid() governs
      })
      if (rpcError) return json({ success: false, error: rpcError.message }, 400)
      if (rpcResult?.status === 'error') return json({ success: false, error: rpcResult.message }, 400)
      if (rpcResult?.status === 'already_member' || rpcResult?.status === 'added') {
        alreadyHandled = true
      }

      finalProjectId = projectId
      finalRole = 'worker'
      const { data: callerMembership } = await userClient
        .from('company_members').select('company_id').eq('user_id', user.id).maybeSingle()
      finalCompanyId = callerMembership?.company_id ?? null

    } else {
      const { data: rpcResult, error: rpcError } = await userClient.rpc('invite_to_company', {
        p_email: normalizedEmail,
        p_invited_by: user.id, // ignored server-side once 090009 is applied; auth.uid() governs
        p_role: typeof role === 'string' ? role : 'worker',
      })
      if (rpcError) return json({ success: false, error: rpcError.message }, 400)
      if (rpcResult?.status === 'error') return json({ success: false, error: rpcResult.message }, 400)
      if (rpcResult?.status === 'added' || rpcResult?.status === 'already_member') alreadyHandled = true

      finalRole = typeof role === 'string' ? role : 'worker'
      const { data: callerMembership } = await userClient
        .from('company_members').select('company_id').eq('user_id', user.id).maybeSingle()
      finalCompanyId = callerMembership?.company_id ?? null
    }

    // Nothing left to email about -- the person was added directly or already
    // belonged. Sending an "you've been invited" email here would be wrong.
    if (alreadyHandled) {
      return json({ success: true, status: 'added' })
    }

    const { data: companyRow } = finalCompanyId
      ? await supabaseAdmin.from('companies').select('name').eq('id', finalCompanyId).maybeSingle()
      : { data: null }
    const companyName = companyRow?.name ?? 'FieldOps'

    const { error: authInviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: {
        invited_by: user.id,
        company_name: companyName,
        role: finalRole,
        project_id: finalProjectId,
        company_id: finalCompanyId,
      },
      redirectTo: isClient ? 'https://app.fieldopspro.org/client-portal' : 'https://app.fieldopspro.org/accept-invite',
    })
    if (authInviteError) {
      if (insertedInvitationId) {
        await supabaseAdmin.from('invitations').delete().eq('id', insertedInvitationId)
      }
      return json({ success: false, error: authInviteError.message }, 400)
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
          <strong style="color: #F97316;">${esc(companyName)}</strong> has invited you to view your project updates on FieldOps Pro.
        </p>
        <a href="https://app.fieldopspro.org/client-login" style="display: inline-block; padding: 14px 32px; background: #F97316; color: #FFFFFF; font-weight: 900; font-size: 15px; text-decoration: none; border-radius: 10px; letter-spacing: 2px;">
          VIEW MY PROJECT
        </a>
        <p style="color: #374151; font-size: 12px; margin-top: 32px;">Questions? Email us at fieldops.pro1@gmail.com</p>
      </div>
    ` : `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #0A0F1E; color: #FFFFFF; border-radius: 16px;">
        <h1 style="color: #F97316; font-size: 28px; letter-spacing: 4px; margin-bottom: 8px;">FIELDOPS</h1>
        <p style="color: #6B7280; font-size: 13px; margin-bottom: 32px;">PRO</p>
        <h2 style="font-size: 20px; margin-bottom: 16px;">You have been invited!</h2>
        <p style="color: #9CA3AF; font-size: 15px; line-height: 1.6; margin-bottom: 8px;">
          You have been invited to join <strong style="color: #F97316;">${esc(companyName)}</strong> on FieldOps as a <strong style="color: #FFFFFF;">${esc(finalRole)}</strong>.
        </p>
        <p style="color: #9CA3AF; font-size: 14px; line-height: 1.6; margin-bottom: 28px;">
          You should have received a separate email with a secure confirmation link. Click that link first to set your password, then download the <strong style="color: #F97316;">FieldOps Pro</strong> mobile app to get started.
        </p>
        <p style="color: #6B7280; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;">Download the App</p>
        <a href="https://apps.apple.com/app/id6767338478" style="display: inline-block; padding: 12px 24px; background: #F97316; color: #FFFFFF; font-weight: 900; font-size: 13px; text-decoration: none; border-radius: 8px; letter-spacing: 1px; margin-bottom: 28px;">
          🍎 Download on the App Store
        </a>
        <!-- TODO: Add Google Play button once Android app is published.
        <a href="https://play.google.com/store/apps/details?id=com.fieldopspro.app" style="display: inline-block; padding: 12px 20px; background: transparent; border: 1px solid #374151; color: #9CA3AF; font-weight: 700; font-size: 13px; text-decoration: none; border-radius: 8px; letter-spacing: 1px;">
          ▶ Google Play
        </a>
        -->
        <p style="color: #4B5563; font-size: 12px; margin-bottom: 4px;">Log in to the mobile app using your email and the password you create when you click the confirmation link.</p>
        <p style="color: #374151; font-size: 12px; margin-top: 24px;">Questions? Email us at fieldops.pro1@gmail.com</p>
      </div>
    `

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'FieldOps <fieldops.pro1@gmail.com>',
        to: normalizedEmail,
        subject,
        html: bodyHtml,
      }),
    })

    if (!emailRes.ok) {
      // The real invite (auth.admin.inviteUserByEmail, with the working confirmation
      // link) already succeeded at this point -- the branded Resend email is a nice-
      // to-have on top of it, not the thing that actually grants access. Report
      // success with a warning instead of failing the whole request.
      const emailErrorBody = await emailRes.text()
      console.error('send-invite: Resend request failed:', emailRes.status, emailErrorBody)
      return json({ success: true, status: 'invited', emailWarning: 'branded email failed' })
    }

    return json({ success: true, status: 'invited' })
  } catch (error: any) {
    return json({ success: false, error: error.message }, 400)
  }
})
