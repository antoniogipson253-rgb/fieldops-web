-- PREPARED, NOT APPLIED. Apply order: SIXTH, last of this batch, alongside 090005.
--
-- project-photos has NO authenticated-path policy at all today (confirmed --
-- only the bucket's public flag grants any read currently). This CREATES a new
-- policy; there is nothing to "tighten" because nothing existed.
--
-- Path convention confirmed from mobile's punch-list.tsx:
-- punch-list/<projectId>/<timestamp>-<random>.<ext> -- the project_id is always
-- the second folder segment. A naive ((storage.foldername(name))[2])::uuid cast
-- would raise an error (and fail the whole query) for any object whose path
-- doesn't match that shape. This function checks the segment against a UUID
-- regex first and only casts if it matches -- a non-matching path returns NULL,
-- which is_project_member(NULL, ...) safely treats as "not visible," never an
-- error.

CREATE OR REPLACE FUNCTION public.project_photo_project_id(p_path text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $f$
DECLARE
  seg text;
BEGIN
  seg := (storage.foldername(p_path))[2];
  IF seg IS NULL OR seg !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN seg::uuid;
END;
$f$;

CREATE POLICY "Authenticated users can view project photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'project-photos' AND is_project_member(project_photo_project_id(name), auth.uid())
  );

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Authenticated users can view project photos" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.project_photo_project_id(text);

-- Affected flows: none -- punch-list.tsx uses getPublicUrl() (the public bucket
-- flag), not this authenticated path, so this is purely additive and doesn't
-- change how the app currently fetches these images.
--
-- TESTED 2026-11-23, inside a rolled-back transaction, the helper function
-- alone (not yet wired into the live policy) against four inputs:
--   'punch-list/065c6765-.../1234.jpg'  -> correctly extracted the UUID
--   'punch-list/not-a-uuid-at-all/...'  -> NULL, no error
--   'justafile.jpg' (too short)         -> NULL, no error
--   '' (empty string)                   -> NULL, no error
--
-- Test after applying for real: no existing flow should change (confirm the
-- punch list photo feature still works exactly as before). Optionally confirm,
-- via a direct API call, that an authenticated project member can now also read
-- via this new authenticated path, and a non-member cannot.
