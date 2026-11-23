-- Rollback file for the Step A security fixes, revised 2026-11-23 after the
-- recursion/scoping/casting corrections. Captured BEFORE any change was
-- applied. Each section corresponds to one of the split migration files in
-- supabase/migrations/20261123090001..090006_*.sql -- apply the matching
-- rollback section if that specific migration needs to be undone.
-- Nothing in this file has been run.

-- ============================================================
-- 090001: update_company_plan_limits(uuid, text)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.update_company_plan_limits(uuid, text) TO anon, authenticated, public;

-- ============================================================
-- 090002: cleanup_old_notifications()
-- ============================================================
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO anon, authenticated, public;

-- ============================================================
-- 090003: company_members DELETE policy + is_company_admin()
-- Pre-fix state: no is_company_admin function existed; the policy was:
-- ============================================================
DROP POLICY IF EXISTS "Users can delete company members" ON public.company_members;
CREATE POLICY "Users can delete company members" ON public.company_members
  FOR DELETE
  USING (is_company_member(company_id, auth.uid()));
DROP FUNCTION IF EXISTS public.is_company_admin(uuid, uuid);

-- ============================================================
-- 090004: user_presence SELECT policy
-- Pre-fix state: USING (true)
-- ============================================================
DROP POLICY IF EXISTS "Users can view presence" ON public.user_presence;
CREATE POLICY "Users can view presence" ON public.user_presence
  FOR SELECT
  USING (true);

-- ============================================================
-- 090005: storage.objects "Authenticated users can view project files"
-- Pre-fix state: bucket_id match + authenticated role only, no project scoping
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view project files" ON storage.objects;
CREATE POLICY "Authenticated users can view project files" ON storage.objects
  FOR SELECT
  USING ((bucket_id = 'project-files'::text) AND (auth.role() = 'authenticated'::text));

-- ============================================================
-- 090006: storage.objects "Authenticated users can view project photos" + helper
-- Pre-fix state: this policy and function did not exist at all.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view project photos" ON storage.objects;
DROP FUNCTION IF EXISTS public.project_photo_project_id(text);

-- ============================================================
-- NOT INCLUDED in this batch -- task-photos' "Public can view photos" policy.
-- Deferred: that bucket is shared by six unrelated features (task_photos,
-- incident-report.tsx, budget.tsx expense receipts, change-orders.tsx,
-- rfi-log.tsx, chat.tsx, and avatars via useAvatarUpload.ts), several with no
-- project_id in their storage path and no tracking-table join available (e.g.
-- incident photos are stored at "incidents/<timestamp>.<ext>" with nothing to
-- scope against). All of them read via getPublicUrl(), not the authenticated
-- path this policy governs, so leaving the current policy in place is safe for
-- now -- but writing a correct replacement needs its own pass to map each
-- feature's access rule individually, not a single project-membership check
-- that would silently mishandle avatars/incidents/receipts. No file for this
-- is included in the current migration batch.
