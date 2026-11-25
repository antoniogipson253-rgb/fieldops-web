-- PREPARED, NOT APPLIED. Landing-page prerequisite (web/landing-prereqs branch) --
-- changes the new-signup trial length from 14 to 30 days, for NEW signups only.
--
-- Read-first: fetched the LIVE definition of public.handle_new_user() via
-- pg_get_functiondef (read-only). This CREATE OR REPLACE is identical to that
-- live definition in every way -- security definer, no search_path pin (the
-- live function does not have one; it is not added here, see note below),
-- every branch (client signup, invited signup, new-company signup), the
-- EXCEPTION handler -- except one line in the new-company branch:
--   NOW() + INTERVAL '14 days'   ->   NOW() + INTERVAL '30 days'
--
-- Note: the task description mentioned "pinned search_path" as part of what
-- should carry over unchanged. The live function has no SET search_path
-- clause at all (confirmed via pg_get_functiondef just now), so there is
-- nothing to preserve there -- flagging this rather than silently adding one,
-- since that would make this migration NOT identical to live apart from the
-- approved change. Adding a search_path pin, if wanted, should be its own
-- separate, deliberate change.
--
-- Existing trial_end values are untouched: this function only runs on INSERT
-- into auth.users (via the on_auth_user_created trigger, not re-created here
-- since CREATE OR REPLACE FUNCTION updates the body in place), so only
-- signups that happen after this is applied get 30 days. Every existing
-- profiles.trial_end already holds a concrete timestamp computed at that
-- user's own signup time and is not recalculated.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  new_company_id UUID;
  v_invite record;
  v_meta_role text;
  v_project_id uuid;
  v_company_id uuid;
BEGIN
  v_meta_role := NEW.raw_user_meta_data->>'role';

  SELECT company_id, role, project_id INTO v_invite
  FROM public.invitations
  WHERE email = lower(NEW.email)
  AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_meta_role = 'client' OR v_invite.role = 'client' THEN

    INSERT INTO public.profiles (id, full_name, email, role, trial_start, trial_end, is_subscribed)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'Client'),
      NEW.email,
      'client',
      NOW(),
      NOW(),
      true
    )
    ON CONFLICT (id) DO NOTHING;

    v_project_id := COALESCE(
      (NEW.raw_user_meta_data->>'project_id')::uuid,
      v_invite.project_id
    );
    v_company_id := COALESCE(
      (NEW.raw_user_meta_data->>'company_id')::uuid,
      v_invite.company_id
    );

    IF v_project_id IS NOT NULL AND v_company_id IS NOT NULL THEN
      INSERT INTO public.client_projects (client_id, project_id, company_id)
      VALUES (NEW.id, v_project_id, v_company_id)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF v_invite.company_id IS NOT NULL THEN

    INSERT INTO public.profiles (id, full_name, email, role, trial_start, trial_end, is_subscribed)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
      NEW.email,
      v_invite.role,
      NOW(),
      NOW(),
      true
    )
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.profiles
    SET company_id = v_invite.company_id
    WHERE id = NEW.id;

    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_invite.company_id, NEW.id, v_invite.role)
    ON CONFLICT DO NOTHING;

  ELSE

    INSERT INTO public.profiles (id, full_name, email, role, trial_start, trial_end, is_subscribed)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
      NEW.email,
      CASE WHEN NEW.raw_user_meta_data->>'company_name' IS NOT NULL THEN 'admin' ELSE 'worker' END,
      NOW(),
      NOW() + INTERVAL '30 days',
      false
    )
    ON CONFLICT (id) DO NOTHING;

    IF NEW.raw_user_meta_data->>'company_name' IS NOT NULL THEN
      INSERT INTO public.companies (name, created_by, max_admins, max_project_managers, max_workers, max_members, plan, storage_used, storage_limit)
      VALUES (
        NEW.raw_user_meta_data->>'company_name',
        NEW.id,
        1, 4, 5, 10, 'trial', 0, 1099511627776
      )
      RETURNING id INTO new_company_id;

      UPDATE public.profiles
      SET company_id = new_company_id
      WHERE id = NEW.id;

      INSERT INTO public.company_members (company_id, user_id, role)
      VALUES (new_company_id, NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
    END IF;

  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$function$;

-- ROLLBACK: CREATE OR REPLACE the function again with NOW() + INTERVAL '14 days'
-- in the new-company branch (the exact live body this file started from is in
-- supabase/manual/rollback-2026-11-23.sql).
