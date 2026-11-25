-- STEP (export follow-up 1). Read-first findings (2026-11-25):
--
-- The only policy on storage.objects for bucket 'project-exports' is a SELECT
-- policy, "Company members can read their project exports", USING
-- can_read_project_export(project_export_object_project(name)) -- company
-- membership, ANY role. project_export_object_project() only matches a bare
-- "<uuid>.xlsx" name; anything under "mobile/" already returns NULL from that
-- regex and was already unreachable through this policy (confirmed, matches
-- the function's own documented design). No INSERT/UPDATE/DELETE policy
-- exists on this bucket at all -- all writes go through the service-role
-- client in build-project-export/send-project-export.
--
-- Confirmed nothing in the app actually depends on member-wide reads through
-- this policy:
--   - web calls build-project-export with no `format`, which returns the
--     bytes directly in the HTTP response -- it never reads storage.objects
--     itself for this bucket.
--   - mobile calls with format: 'signedUrl', which stores under a different
--     path ("mobile/<project_id>.xlsx", already excluded by the regex above)
--     and reads via a signed URL minted by the service-role client -- also
--     never exercises this authenticated-role policy.
--   - send-project-export (scheduled email delivery) builds its own
--     workbook bytes independently via the same shared helper and attaches
--     them directly to the email -- it never touches storage.objects at all.
--   - grep across both repos: zero client-side references to the
--     'project-exports' bucket anywhere outside these two edge functions.
-- This policy is therefore dead code in every current flow -- the only way
-- to exercise it today is a direct Storage API call bypassing the edge
-- function entirely, which is exactly the gap this closes.

CREATE OR REPLACE FUNCTION public.is_admin_or_pm_of_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $f$
  select exists (
    select 1
    from public.projects p
    join public.profiles creator on creator.id = p.created_by
    join public.company_members cm on cm.company_id = creator.company_id
    where p.id = p_project_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'project_manager')
  );
$f$;

DROP POLICY IF EXISTS "Company members can read their project exports" ON storage.objects;
CREATE POLICY "Admins and PMs can read their project exports" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-exports'
    AND is_admin_or_pm_of_project(project_export_object_project(name))
  );

-- Being admin/PM of the company that owns the project already implies company
-- membership, so this single check fully replaces can_read_project_export
-- for this policy -- no need to AND them together. service_role is untouched
-- (RLS does not apply to it); the mobile/ path remains unreachable through
-- this policy either way (project_export_object_project returns NULL for it).

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Admins and PMs can read their project exports" ON storage.objects;
-- CREATE POLICY "Company members can read their project exports" ON storage.objects
--   FOR SELECT USING ((bucket_id = 'project-exports'::text) AND can_read_project_export(project_export_object_project(name)));
-- DROP FUNCTION IF EXISTS public.is_admin_or_pm_of_project(uuid);
