-- PREPARED, NOT APPLIED. STEP C-1, part 3. Do not apply without separate approval,
-- and only against the disposable test company once it exists -- never against a
-- real company.
--
-- Rewrites invite_to_company (both overloads) and invite_user_to_project to stop
-- trusting the caller-supplied p_invited_by parameter (today it is used blindly --
-- any value the caller sends is looked up directly, with zero check that it is
-- the caller's own id). All three now derive the inviter from auth.uid() instead,
-- and require that inviter to actually have authority over the company/project
-- they're inviting into. p_invited_by is kept in each signature only so existing
-- callers (web TeamPage.tsx / ProjectDetailPage.tsx, mobile company.tsx / team.tsx,
-- supabase/functions/send-invite/index.ts) don't need to change their call shape
-- immediately -- the value they pass is now ignored.
--
-- invite_user_to_project's "invited" response no longer returns the invitation
-- token. Confirmed by reading both callers (ProjectDetailPage.tsx, team.tsx) that
-- neither reads data.token -- the actual invite link sent to the user is a
-- separate, Supabase-generated magic link from auth.admin.inviteUserByEmail
-- (called by send-invite), not this token.
--
-- Role mapping note: project_members.role only ever takes 'owner' or 'member' in
-- this schema (no 'project_manager' value exists there). "admin/PM of the
-- project" is implemented as: the caller is the project's 'owner' in
-- project_members, OR the caller is an 'admin' or 'project_manager' in
-- company_members for the company that created the project (projects has no
-- direct company_id column; company is resolved via projects.created_by ->
-- profiles.company_id, the same indirect join already used when the storage
-- policies were reviewed). Please confirm this mapping is what you intended --
-- it's the closest fit to the roles that actually exist in this schema.

CREATE OR REPLACE FUNCTION public.invite_to_company(p_email text, p_invited_by uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_caller uuid := auth.uid();
  v_user_id uuid;
  v_company_id uuid;
  v_caller_role text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Not authenticated');
  END IF;

  SELECT company_id, role INTO v_company_id, v_caller_role
  FROM public.company_members WHERE user_id = v_caller LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'You are not part of a company');
  END IF;

  IF v_caller_role <> 'admin' THEN
    RETURN json_build_object('status', 'error', 'message', 'Only company admins can invite members');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, 'member')
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles SET company_id = v_company_id WHERE id = v_user_id;

    RETURN json_build_object('status', 'added');
  ELSE
    INSERT INTO public.invitations (project_id, invited_by, email, status)
    VALUES (null, v_caller, lower(p_email), 'pending')
    ON CONFLICT DO NOTHING;

    RETURN json_build_object('status', 'invited');
  END IF;
END;
$f$;

CREATE OR REPLACE FUNCTION public.invite_to_company(p_email text, p_invited_by uuid, p_role text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_caller uuid := auth.uid();
  v_user_id uuid;
  v_company_id uuid;
  v_caller_role text;
  v_total_members int;
  v_max_members int;
  v_plan text;
  v_max_admins int;
  v_max_pms int;
  v_max_workers int;
  v_role_count int;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Not authenticated');
  END IF;

  SELECT company_id, role INTO v_company_id, v_caller_role
  FROM public.company_members WHERE user_id = v_caller LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'You are not part of a company');
  END IF;

  IF v_caller_role <> 'admin' THEN
    RETURN json_build_object('status', 'error', 'message', 'Only company admins can invite members');
  END IF;

  SELECT plan, max_members, max_admins, max_project_managers, max_workers
  INTO v_plan, v_max_members, v_max_admins, v_max_pms, v_max_workers
  FROM public.companies WHERE id = v_company_id;

  SELECT COUNT(*) INTO v_total_members FROM public.company_members WHERE company_id = v_company_id;

  IF v_total_members >= v_max_members THEN
    IF v_plan = 'trial' THEN
      RETURN json_build_object('status', 'error', 'message', 'Team limit reached. Your trial allows 10 members. Upgrade to add more.');
    ELSIF v_plan = 'field' THEN
      RETURN json_build_object('status', 'error', 'message', 'Team limit reached. Field Plan allows 10 members. Upgrade to Crew Plan for up to 40 members.');
    ELSIF v_plan = 'crew' THEN
      RETURN json_build_object('status', 'error', 'message', 'Team limit reached. Crew Plan allows 40 members. Upgrade to Project Plan for up to 120 members.');
    ELSIF v_plan = 'project' THEN
      RETURN json_build_object('status', 'error', 'message', 'Team limit reached. Project Plan allows 120 members. Contact us for Enterprise pricing.');
    ELSE
      RETURN json_build_object('status', 'error', 'message', 'Team limit reached. Please upgrade your plan.');
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_role_count FROM public.company_members WHERE company_id = v_company_id AND role = p_role;

  IF p_role = 'admin' AND v_role_count >= v_max_admins THEN
    RETURN json_build_object('status', 'error', 'message', 'Admin limit reached. Your plan allows 1 admin.');
  END IF;

  IF p_role = 'project_manager' AND v_role_count >= v_max_pms THEN
    RETURN json_build_object('status', 'error', 'message', 'Project Manager limit reached for your current plan.');
  END IF;

  IF p_role = 'worker' AND v_role_count >= v_max_workers THEN
    RETURN json_build_object('status', 'error', 'message', 'Worker limit reached for your current plan.');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, p_role)
    ON CONFLICT DO NOTHING;

    UPDATE public.profiles SET company_id = v_company_id, role = p_role WHERE id = v_user_id;

    RETURN json_build_object('status', 'added');
  ELSE
    INSERT INTO public.invitations (project_id, invited_by, email, status, company_id, role)
    VALUES (null, v_caller, lower(p_email), 'pending', v_company_id, p_role)
    ON CONFLICT DO NOTHING;

    RETURN json_build_object('status', 'invited');
  END IF;
END;
$f$;

CREATE OR REPLACE FUNCTION public.invite_user_to_project(p_project_id uuid, p_email text, p_invited_by uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
DECLARE
  v_caller uuid := auth.uid();
  v_user_id uuid;
  v_project_name text;
  v_inviter_name text;
  v_invitation_id uuid;
  v_project_company_id uuid;
  v_is_owner boolean;
  v_is_company_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Not authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_project_id AND user_id = v_caller AND role = 'owner'
  ) INTO v_is_owner;

  SELECT prof.company_id INTO v_project_company_id
  FROM public.projects proj
  JOIN public.profiles prof ON prof.id = proj.created_by
  WHERE proj.id = p_project_id;

  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = v_project_company_id AND user_id = v_caller AND role IN ('admin', 'project_manager')
  ) INTO v_is_company_admin;

  IF NOT (v_is_owner OR v_is_company_admin) THEN
    RETURN json_build_object('status', 'error', 'message', 'Only the project owner or a company admin/PM can invite to this project');
  END IF;

  SELECT name INTO v_project_name FROM public.projects WHERE id = p_project_id;
  SELECT full_name INTO v_inviter_name FROM public.profiles WHERE id = v_caller;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);

  IF v_user_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project_id AND user_id = v_user_id) THEN
      RETURN json_build_object('status', 'already_member');
    END IF;

    INSERT INTO public.project_members (project_id, user_id, role) VALUES (p_project_id, v_user_id, 'member');

    RETURN json_build_object('status', 'added', 'user_id', v_user_id);
  ELSE
    INSERT INTO public.invitations (project_id, invited_by, email)
    VALUES (p_project_id, v_caller, lower(p_email))
    RETURNING id INTO v_invitation_id;

    RETURN json_build_object(
      'status', 'invited',
      'invitation_id', v_invitation_id,
      'project_name', v_project_name,
      'inviter_name', v_inviter_name
    );
  END IF;
END;
$f$;

-- ROLLBACK: re-run the three CREATE OR REPLACE FUNCTION statements exactly as they
-- are captured in C:\Users\anton\fieldops-backups\2026-11-23\schema-snapshot.sql
-- (the pre-change source for all three, pulled via pg_get_functiondef before any
-- Step C change was made).
