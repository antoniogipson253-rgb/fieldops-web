-- STEP (Phase 2 sweep item 2). Scopes get_company_members and get_user_id_by_email
-- to the caller's own authority. Neither previously checked the caller's identity
-- at all -- post-090008 they require SOME authenticated session, but any
-- authenticated user from any company could still call either one.
--
-- get_company_members: returns an empty set (not an error) if auth.uid() is not a
-- member of p_company_id. Uses an inline EXISTS rather than the existing
-- is_company_member() helper -- that helper still lacks a pinned search_path
-- (same gap noted when 090003 was written), so this follows that same
-- fix-forward precedent instead of depending on it.
--
-- get_user_id_by_email: returns NULL (not an error) unless auth.uid() is an
-- admin or project_manager in some company. This matches exactly what the
-- instruction asked for -- a caller-authority check, not a check that the
-- target email's company matches the caller's (this function takes no company
-- parameter at all and is used purely as an email->uuid lookup ahead of an
-- invite flow).
--
-- Both signatures, return types, and grants are unchanged.

CREATE OR REPLACE FUNCTION public.get_company_members(p_company_id uuid)
RETURNS TABLE(id uuid, company_id uuid, user_id uuid, role text, created_at timestamp with time zone, full_name text, profile_role text, phone text, avatar_url text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  select
    cm.id,
    cm.company_id,
    cm.user_id,
    cm.role,
    cm.created_at,
    p.full_name,
    p.role as profile_role,
    p.phone,
    p.avatar_url
  from public.company_members cm
  join public.profiles p on p.id = cm.user_id
  where cm.company_id = p_company_id
    and exists (
      select 1 from public.company_members caller
      where caller.company_id = p_company_id and caller.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(email_input text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  select id from auth.users
  where lower(email) = lower(email_input)
    and exists (
      select 1 from public.company_members cm
      where cm.user_id = auth.uid() and cm.role in ('admin', 'project_manager')
    )
  limit 1;
$function$;

-- ROLLBACK: re-run the two CREATE OR REPLACE FUNCTION statements exactly as
-- captured in C:\Users\anton\fieldops-backups\2026-11-23\schema-snapshot.sql
-- (pre-change source for both, pulled via pg_get_functiondef before any Phase 2
-- sweep change was made). Neither originally had SET search_path, so the
-- rollback also removes that pin.
