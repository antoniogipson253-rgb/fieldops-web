-- STEP C-1, part 2. Revokes-only -- does NOT change any function body.
--
-- Caller map (full detail reported separately): every real caller of these five
-- functions runs signed-in, behind an authenticated screen (web TeamPage.tsx /
-- ProjectDetailPage.tsx, mobile company.tsx / team.tsx / useCompany.ts / useTeam.ts).
-- None of them need anon access. The one anonymous-reachable caller found
-- (supabase/functions/send-invite/index.ts) calls invite_to_company using the
-- SERVICE ROLE client, so it is unaffected by this revoke either way -- it has
-- its own, separate missing-auth-check problem, tracked outside this migration.
--
-- None of the five function bodies check that the caller is an admin or member
-- of the target company/project -- invite_to_company and invite_user_to_project
-- blindly trust the caller-supplied p_invited_by parameter; get_company_members
-- and get_user_id_by_email take no caller-identity parameter at all and apply no
-- authorization check whatsoever. That is fixed in 090009 (prepared, not applied).
-- This migration only removes anonymous/public reachability in the meantime.
--
-- handle_new_user is intentionally NOT included: it is a trigger function
-- (RETURNS trigger), not realistically callable via RPC, and trigger firing is
-- not gated by the firing role's EXECUTE grant on the trigger function.

REVOKE EXECUTE ON FUNCTION public.invite_to_company(text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.invite_to_company(text, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.invite_user_to_project(uuid, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_company_members(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon, public;

-- ROLLBACK:
-- GRANT EXECUTE ON FUNCTION public.invite_to_company(text, uuid) TO anon, public;
-- GRANT EXECUTE ON FUNCTION public.invite_to_company(text, uuid, text) TO anon, public;
-- GRANT EXECUTE ON FUNCTION public.invite_user_to_project(uuid, text, uuid) TO anon, public;
-- GRANT EXECUTE ON FUNCTION public.get_company_members(uuid) TO anon, public;
-- GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO anon, public;
