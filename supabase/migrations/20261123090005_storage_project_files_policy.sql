-- PREPARED, NOT APPLIED. Apply order: FIFTH -- storage policies go last, after
-- everything above has been applied and tested.
--
-- Previously: "Authenticated users can view project files" USING (bucket_id =
-- 'project-files' AND auth.role() = 'authenticated') -- ANY logged-in user, any
-- company, could read ANY file in this bucket via the authenticated REST/signed-
-- URL path. (The bucket's public flag is intentionally untouched here, per
-- instruction -- this only tightens the authenticated-role path.)
--
-- Confirmed this policy name covers exactly one bucket (project-files) -- no
-- splitting needed.
--
-- Files are stored at "<uploader_uid>/<project_id>/<filename>" (confirmed from
-- mobile's hooks/useFiles.ts), but rather than parse that convention, this joins
-- against project_files.storage_key -- the authoritative row -- so it stays
-- correct even if the path format ever changes.

DROP POLICY IF EXISTS "Authenticated users can view project files" ON storage.objects;
CREATE POLICY "Authenticated users can view project files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'project-files' AND EXISTS (
      SELECT 1 FROM public.project_files pf
      WHERE pf.storage_key = storage.objects.name AND is_project_member(pf.project_id, auth.uid())
    )
  );

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Authenticated users can view project files" ON storage.objects;
-- CREATE POLICY "Authenticated users can view project files" ON storage.objects
--   FOR SELECT USING ((bucket_id = 'project-files'::text) AND (auth.role() = 'authenticated'::text));

-- On the "can a company admin who isn't a project_member view files" concern:
-- checked is_project_member() directly -- it only checks project_members, with
-- no admin carve-out. BUT this matches the existing, already-enforced boundary:
-- the `projects` table's own "Users can view their projects" SELECT policy uses
-- the exact same created_by-or-project_members logic with no admin exception,
-- and every other project-scoped table (tasks, folders, project_files itself)
-- follows it too. Checked real data: 0 of 6 admin-created projects have a
-- creator who isn't also a project_member -- project creation evidently always
-- adds the creator. Also checked FilesPage.tsx's admin-only "all projects"
-- toggle -- it queries project_files directly, which is ALREADY restricted to
-- is_project_member() at the table level, so an admin using that toggle could
-- already only ever see files for projects they're a member of, same as today.
-- Conclusion: an admin who can't see a project today (not a member, didn't
-- create it) could never reach its files either way -- this fix doesn't change
-- that boundary, it just closes the gap between storage and the table it
-- describes. If you want company-wide admin visibility as a NEW capability,
-- that needs to start at the `projects` table's own policy, not here, and is a
-- separate decision.
--
-- Signed-URL / upload-order check: createSignedUrl enforces this SELECT policy
-- at mint time, same as a direct read. Traced the mobile upload flow
-- (hooks/useFiles.ts): it uploads the file to storage FIRST, then inserts the
-- project_files row SECOND -- there is a brief window where the object exists
-- but no row does. Nothing reads the object back during that window; the UI
-- only ever displays/opens a file after its project_files row exists (via
-- useProjectFiles' query). No read-before-row-exists path found.
--
-- TESTED 2026-11-23 against a real existing file, inside a rolled-back
-- transaction: a real project member could see the object (1 row); a real user
-- from a different, unrelated company could not (0 rows).
--
-- Test after applying for real: as a project member, open Files and preview an
-- existing file -- should still work. As a member of a different, unrelated
-- project, attempt a direct signed-URL read for this file's storage_key --
-- should now be rejected (previously would have succeeded).
