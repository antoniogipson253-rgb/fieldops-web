-- ROLLBACK for 20261119090000_project_export_frequency.sql
-- Run manually ONLY to back the "Send when" setting out. Restores the shared before-write
-- trigger function to its previous body (exactly as in 20261117090000), removes the column
-- grants, and drops the five new columns with their constraints. Nothing else is touched:
-- the on/off switch, recipients, send time, the daily report settings, the rebuild queue and
-- the cron jobs are unaffected.
--
-- BEFORE running: redeploy the previous send-project-export (git: the version before the
-- "Send when" change); the new version reads these columns. Also deploy a web build without
-- the "Send when" choice, or the report settings screen will fail to load.

begin;

create or replace function public.project_report_settings_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = 'RPT04';
  end if;

  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.last_report_cutoff := now();
  end if;

  -- First spreadsheet email (and the first after re-enabling) waits for the next send time.
  if new.export_email_enabled and (tg_op = 'INSERT' or not old.export_email_enabled) then
    new.export_enabled_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke insert (export_frequency, export_weekday) on public.project_report_settings from authenticated;
revoke update (export_frequency, export_weekday) on public.project_report_settings from authenticated;
revoke select (export_frequency, export_weekday, export_last_outcome, export_last_outcome_at)
  on public.project_report_settings from authenticated;

alter table public.project_report_settings
  drop column if exists export_frequency,
  drop column if exists export_weekday,
  drop column if exists export_last_sent_hash,
  drop column if exists export_last_outcome,
  drop column if exists export_last_outcome_at;   -- their check constraints go with them

commit;
