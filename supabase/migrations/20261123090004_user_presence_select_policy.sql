-- PREPARED, NOT APPLIED. Apply order: FOURTH, alongside the company_members
-- DELETE policy (090003), before the storage policies.
--
-- Previously: "Users can view presence" USING (true) -- readable by anyone,
-- anon included, across every company. Scoped to project membership, matching
-- every other project-scoped table's pattern (is_project_member).

DROP POLICY IF EXISTS "Users can view presence" ON public.user_presence;
CREATE POLICY "Users can view presence" ON public.user_presence
  FOR SELECT
  USING (is_project_member(project_id, auth.uid()));

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Users can view presence" ON public.user_presence;
-- CREATE POLICY "Users can view presence" ON public.user_presence
--   FOR SELECT USING (true);

-- Affected flows: the only consumer found is mobile's hooks/useMessages.ts (project
-- chat "who's online" indicator). The table is currently empty in production (0
-- rows), so this is low-risk.
-- Test: open a project chat as a member of that project on mobile -- presence
-- indicators should still show. Confirm, via a direct API call (not the UI), that
-- a user from a different company/project can no longer read another project's
-- presence rows.
