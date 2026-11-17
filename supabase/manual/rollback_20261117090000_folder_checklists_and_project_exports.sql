-- ROLLBACK for 20261117090000_folder_checklists_and_project_exports.sql
-- Run manually ONLY to back the feature out. Removes every table, column, trigger, function,
-- policy and the bucket that migration added, and restores the two functions it replaced
-- (enforce_checklist_item_cap, project_report_settings_before_write) to their previous bodies.
--
-- Task checklist items are KEPT: they become ordinary per-task items again (only the link to
-- the folder checklist is dropped). Folder checklists themselves are deleted.
--
-- BEFORE running:
--  1. Unschedule the cron jobs if they were registered (this script also tries):
--       select cron.unschedule('build-project-exports');  select cron.unschedule('send-project-exports');
--  2. Undeploy the build-project-export and send-project-export edge functions.
-- AFTER running:
--  3. Delete the storage bucket "project-exports" (with its files) in the Supabase dashboard
--     (Storage) or via the Storage API. Supabase blocks deleting buckets with SQL.

begin;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'build-project-exports') then perform cron.unschedule('build-project-exports'); end if;
  if exists (select 1 from cron.job where jobname = 'send-project-exports') then perform cron.unschedule('send-project-exports'); end if;
end $$;

-- triggers on pre-existing tables
drop trigger if exists checklist_items_folder_guard on public.checklist_items;
drop trigger if exists checklist_items_drop_unmanaged_extra on public.checklist_items;
drop trigger if exists folders_checklist_managed_guard on public.folders;
drop trigger if exists apply_folder_checklist_to_new_task on public.tasks;
drop trigger if exists mark_export_dirty on public.tasks;
drop trigger if exists mark_export_dirty on public.checklist_items;
drop trigger if exists mark_export_dirty on public.folders;
drop trigger if exists mark_export_dirty on public.projects;

-- restore the replaced functions to their previous definitions
create or replace function public.enforce_checklist_item_cap() returns trigger as $$
begin
  if (select count(*) from public.checklist_items where task_id = new.task_id) >= 45 then
    raise exception 'A task can have at most 45 checklist items';
  end if;
  return new;
end;
$$ language plpgsql;

-- (verbatim from 20261103090000_activity_log_and_daily_report_settings.sql)
create or replace function public.project_report_settings_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = 'RPT04';
  end if;

  -- First report (and the first after re-enabling) starts at the moment it was turned on,
  -- so a re-enable does not dump everything since the last send weeks ago.
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.last_report_cutoff := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- storage: the read policy is dropped here. Supabase does not allow deleting a bucket (or its
-- files) with SQL, even when empty (storage.protect_delete), so delete the "project-exports"
-- bucket afterwards in the dashboard (Storage) or with the Storage API. Without this policy and
-- without the edge functions, nothing can read or write it.
drop policy if exists "Company members can read their project exports" on storage.objects;

-- columns
alter table public.checklist_items drop column if exists folder_item_id;   -- keeps the items themselves
alter table public.folders drop column if exists checklist_managed;
alter table public.project_report_settings
  drop column if exists export_email_enabled,
  drop column if exists export_enabled_at,
  drop column if exists export_last_sent_date,
  drop column if exists export_last_sent_at;

-- tables (their own triggers and policies go with them)
drop table if exists public.folder_checklist_items;
drop table if exists public.project_export_queue;
drop table if exists public.project_export_test_sends;

-- functions
drop function if exists public.save_folder_checklist(uuid, jsonb, boolean);
drop function if exists public.apply_folder_checklist_to_new_task();
drop function if exists public.checklist_items_folder_guard();
drop function if exists public.checklist_items_drop_unmanaged_extra();
drop function if exists public.folders_checklist_managed_guard();
drop function if exists public.enforce_folder_checklist_cap();
drop function if exists public.folder_checklist_syncing();
drop function if exists public.task_folder_is_managed(uuid);
drop function if exists public.trg_mark_export_dirty();
drop function if exists public.mark_project_export_dirty(uuid);
drop function if exists public.can_read_project_export(uuid);
drop function if exists public.project_export_object_project(text);

commit;
