-- PREPARED, NOT APPLIED. DO NOT RUN without explicit approval of the final id
-- list. Deletes the 19 companies confirmed (2026-11-24, read-only sweep) to
-- have ZERO rows anywhere: zero company_members, zero profiles pointing at
-- them, zero projects (and therefore zero tasks/files/photos/messages/daily
-- reports through projects), zero invitations, announcements, incidents,
-- client_projects, time_entries, overtime_settings, report_settings,
-- clock_exemptions, and zero payroll_settings. Because every dependent table
-- is already empty for every one of these 19, this DELETE needs nothing else
-- deleted first and no FK/cascade fires -- it only ever touches these 19 rows.
--
-- Explicitly NOT included (deliberately excluded after review, do not add
-- without separate approval):
--   5cb6aec2-cbb0-4d9b-834a-6c99e2553f19 ("fieldops.pro1's Company") -- also
--     zero projects/zero everything else, but its creator (9768dbb6-...)
--     signed in on 2026-11-20, well after this company's 2026-06-18 creation,
--     and has since moved their profile to a different, real company
--     (a1ee017e, "Test Ops") as a worker. A real, currently active account
--     still has an admin company_members row here. Group B ("possibly
--     real") per the brief's own criteria -- not a safe-looking leftover.
--   a1ee017e-3f65-4822-bdc6-d197c894d9ef ("Test Ops") and
--   d9145793-f35d-44bd-b6bf-3874e9886ec9 ("Great Scott Plumbing") -- both
--     have at least one real project, so they fail the zero-projects
--     criterion entirely and were never candidates.
--   065c6765-2d13-435b-84b0-89e76c1630c0 ("SnT") -- real, active company.
--
-- Backup taken before this file was written:
-- C:\Users\anton\fieldops-backups\2026-11-23\empty-companies-delete-candidates-2026-11-24.json
-- (companies rows only -- nothing else needed backing up, since every
-- dependent table was already confirmed empty for all 19).

BEGIN;

DELETE FROM public.companies
WHERE id IN (
  '05c8e65d-1929-4575-973d-261e77f26fc3',
  '714594c2-4d9f-4560-a0cc-d0feea5410be',
  '2f42cf75-e763-4eea-aed5-d94f666227ac',
  '4e212d4a-31de-4ae3-9b5b-e7dd65c35127',
  '1bfd5e2c-7b99-489a-b377-cd2c8d921c6e',
  '93ebbb54-9f73-483a-9c1b-089a9be5db4f',
  '1b3cbed6-a5e8-4cc7-a189-1e7bdc965ab9',
  'b9976472-e9d4-49bf-abc3-5679aec11b74',
  'f1fb72e0-638c-4be1-9481-58bcb37bbca7',
  '5db69265-2411-459b-8c9f-b20d11d1ee4b',
  '037495c2-9a9c-4c3a-bbc1-d75eac1a2e9b',
  '3a519cd1-458e-462b-97e1-fc565c73ee5f',
  '28602afd-251b-4c87-a11b-fbea4e2210d0',
  'dfdc2b80-bbcb-4274-a7f2-2267de9db37e',
  '5e10701d-d881-458d-b6cd-65bb5e2dda06',
  '38d5dd4c-db9a-42f6-bfd5-e14dcc4a22b8',
  '11a6f7ed-7be7-4781-80d1-9ecb033cf60f',
  '8d57d6ff-6d10-4b85-8308-a78f8c3658e4',
  '7f9e7434-bdd1-480d-8d3f-2761ee8eb7b9'
);

COMMIT;

-- ROLLBACK: restores the 19 companies rows exactly as backed up above.
-- Nothing else needs restoring (no dependent rows existed to delete).
--
-- BEGIN;
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('05c8e65d-1929-4575-973d-261e77f26fc3', 'Test', NULL, '2026-05-20 16:41:18.377044+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('714594c2-4d9f-4560-a0cc-d0feea5410be', 'Test', NULL, '2026-05-20 16:51:28.726505+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('2f42cf75-e763-4eea-aed5-d94f666227ac', 'Test', NULL, '2026-05-20 21:09:10.741009+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('4e212d4a-31de-4ae3-9b5b-e7dd65c35127', 'Test', NULL, '2026-05-20 21:17:24.484711+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('1bfd5e2c-7b99-489a-b377-cd2c8d921c6e', 'Test', NULL, '2026-05-20 21:28:59.963083+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('93ebbb54-9f73-483a-9c1b-089a9be5db4f', 'Test', NULL, '2026-05-20 21:36:33.131831+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('1b3cbed6-a5e8-4cc7-a189-1e7bdc965ab9', 'Test', NULL, '2026-05-20 21:46:00.78521+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('b9976472-e9d4-49bf-abc3-5679aec11b74', 'Test', NULL, '2026-05-20 21:57:31.489911+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('f1fb72e0-638c-4be1-9481-58bcb37bbca7', 'Test', NULL, '2026-05-27 13:48:57.749873+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('5db69265-2411-459b-8c9f-b20d11d1ee4b', 'Test', NULL, '2026-05-27 13:56:12.667358+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('037495c2-9a9c-4c3a-bbc1-d75eac1a2e9b', 'fieldops.pro1''s Company', NULL, '2026-06-17 20:59:54.1958+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('3a519cd1-458e-462b-97e1-fc565c73ee5f', 'fieldops.pro1''s Company', NULL, '2026-06-17 21:31:14.989806+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('28602afd-251b-4c87-a11b-fbea4e2210d0', 'fieldops.pro1''s Company', NULL, '2026-06-17 21:36:20.881841+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('dfdc2b80-bbcb-4274-a7f2-2267de9db37e', 'fieldops.pro1''s Company', NULL, '2026-06-17 21:42:10.97768+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('5e10701d-d881-458d-b6cd-65bb5e2dda06', 'fieldops.pro1''s Company', NULL, '2026-06-17 21:59:54.160642+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('38d5dd4c-db9a-42f6-bfd5-e14dcc4a22b8', 'fieldops.pro1''s Company', NULL, '2026-06-17 22:22:42.763085+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('11a6f7ed-7be7-4781-80d1-9ecb033cf60f', 'fieldops.pro1''s Company', NULL, '2026-06-17 22:38:01.899812+00', 3, 5, 120, 'project', 128, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('8d57d6ff-6d10-4b85-8308-a78f8c3658e4', 'fieldops.pro1''s Company', NULL, '2026-06-18 03:19:56.037879+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- INSERT INTO public.companies (id, name, created_by, created_at, max_admins, max_project_managers, max_workers, plan, max_members, storage_used, storage_limit, storage_bucket) VALUES ('7f9e7434-bdd1-480d-8d3f-2761ee8eb7b9', 'Smith Construction', NULL, '2026-07-15 20:50:24.979384+00', 1, 4, 5, 'trial', 10, 0, 1099511627776, NULL);
-- COMMIT;
