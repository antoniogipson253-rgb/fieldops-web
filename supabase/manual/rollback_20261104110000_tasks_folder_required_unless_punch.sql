-- ROLLBACK for 20261104110000_tasks_folder_required_unless_punch.sql
-- Run manually ONLY to back the fix out. Restores the previous state: folder_id NOT NULL
-- for every task, is_punch_list nullable, no immutability trigger.
--
-- WARNING: restoring NOT NULL on folder_id breaks punch-list creation again (web and mobile).
--
-- Punch items created after the fix have folder_id = NULL, and NOT NULL cannot be restored
-- while they exist. This script refuses (and changes nothing) if any are present; decide
-- what to do with those rows first.

begin;

do $$
declare
  v_null_folder int;
begin
  select count(*) into v_null_folder from public.tasks where folder_id is null;
  if v_null_folder > 0 then
    raise exception 'Rollback refused: % task(s) have no folder (punch items created after the fix). Resolve them before restoring NOT NULL on folder_id.', v_null_folder;
  end if;
end $$;

drop trigger if exists tasks_is_punch_list_immutable on public.tasks;
drop function if exists public.prevent_is_punch_list_change();

alter table public.tasks drop constraint if exists tasks_folder_required_unless_punch;
alter table public.tasks alter column folder_id set not null;

alter table public.tasks alter column is_punch_list drop not null;  -- default false is kept, as before

commit;
