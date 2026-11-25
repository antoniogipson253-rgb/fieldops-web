-- STEP (housekeeping item 1b). Read-first findings (2026-11-25):
--
-- profiles.email is set exactly once, at signup, by handle_new_user() (INSERT
-- ... email ... VALUES ... NEW.email ...). Nothing ever updates it again.
-- Mobile's profile.tsx has a real "change email" flow
-- (supabase.auth.updateUser({ email })), which updates auth.users.email (after
-- Supabase's own confirmation step) but never touches profiles.email -- so a
-- user who changes their email on mobile silently leaves a stale
-- profiles.email behind forever.
--
-- Readers of profiles.email found: web's DailyReportSettings.tsx (resolves
-- report recipients), and edge functions send-daily-reports,
-- send-incident-notification, send-missing-part-reminders (all resolve
-- notification/report recipients the same way). No RLS policy and no other
-- SQL function depends on it.
--
-- Current state (2026-11-25, before this migration): 13 profiles total, 11
-- match auth.users.email exactly (case-insensitive), 2 are NULL, 0 are
-- mismatched to a different address. No case-only mismatches either.
--
-- This trigger only ever sets profiles.email. It does not touch full_name,
-- role, avatar_url, company_id, or anything else on the row.

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $f$
BEGIN
  UPDATE public.profiles SET email = lower(NEW.email) WHERE id = NEW.id;
  RETURN NEW;
END;
$f$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();

-- One-time backfill: only the 2 NULL rows (confirmed above; zero mismatched
-- non-NULL rows exist, so nothing else changes). The exact list of profile
-- ids this touches is saved to C:\Users\anton\fieldops-backups\2026-11-23\
-- (ids only, never emails) before this file is applied.
UPDATE public.profiles p
SET email = lower(u.email)
FROM auth.users u
WHERE u.id = p.id
  AND (p.email IS NULL OR lower(p.email) <> lower(u.email));

-- ROLLBACK:
-- DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
-- DROP FUNCTION IF EXISTS public.sync_profile_email();
-- The backfill itself is not reversible by dropping the trigger (it is a
-- one-time UPDATE, not an ongoing effect) -- to restore the 2 profiles that
-- were NULL before this ran, see the id list saved in the backup folder and
-- set their email back to NULL manually:
--   UPDATE public.profiles SET email = NULL WHERE id IN (<ids from backup file>);
