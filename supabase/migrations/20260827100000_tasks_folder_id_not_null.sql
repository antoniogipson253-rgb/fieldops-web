-- Tasks must always belong to a folder. Mobile has no way to view or navigate to
-- folderless tasks, so they were silently invisible there. All 13 pre-existing
-- folderless tasks (9 in "MDA", 4 in "test") were deleted by explicit request
-- before this migration, so this can be a fully-validated NOT NULL rather than
-- a NOT VALID check constraint.
alter table public.tasks
  alter column folder_id set not null;
