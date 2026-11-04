-- Fix: punch list items could not be created.
--
-- 20260827100000_tasks_folder_id_not_null.sql made tasks.folder_id NOT NULL for every row.
-- Punch list items are tasks rows with is_punch_list = true and have no folder, and both
-- punch-list create paths (web PunchListPage.tsx and mobile punch-list.tsx, including old
-- installed app versions) insert without folder_id, so every punch-item create has failed
-- with 23502 since then.
--
-- New rule: a regular task must have a folder; a punch item may have none.
--   folder_id IS NOT NULL OR is_punch_list IS TRUE
--
-- Closing the bypasses:
--  - is_punch_list was nullable. A CHECK passes when it evaluates to NULL, so
--    "folder_id IS NOT NULL OR is_punch_list = true" would accept is_punch_list = NULL with
--    no folder. is_punch_list becomes NOT NULL (default false; no NULL rows exist), and the
--    check uses IS TRUE as well.
--  - is_punch_list becomes immutable after insert, so a regular task cannot be flipped to a
--    punch item to shed its folder, and a folderless punch item cannot be flipped to a
--    regular task. Neither app ever updates is_punch_list; both only set it on insert.
--
-- Runs as one transaction (db query -f): a failure leaves nothing half-applied.

-- 1. is_punch_list: never NULL
update public.tasks set is_punch_list = false where is_punch_list is null;  -- 0 rows today; defensive
alter table public.tasks
  alter column is_punch_list set default false,
  alter column is_punch_list set not null;

-- 2. Replace the blanket NOT NULL on folder_id with the rule
alter table public.tasks alter column folder_id drop not null;
alter table public.tasks
  add constraint tasks_folder_required_unless_punch
  check (folder_id is not null or is_punch_list is true);

-- 3. is_punch_list is fixed at creation
create or replace function public.prevent_is_punch_list_change() returns trigger
language plpgsql as $$
begin
  if new.is_punch_list is distinct from old.is_punch_list then
    raise exception 'is_punch_list cannot be changed after a task is created'
      using errcode = 'TSK01';
  end if;
  return new;
end;
$$;

create trigger tasks_is_punch_list_immutable
  before update of is_punch_list on public.tasks
  for each row execute function public.prevent_is_punch_list_change();
