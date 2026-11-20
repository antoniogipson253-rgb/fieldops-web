-- Spreadsheet email: "Send when" (daily every day / daily only if something changed / weekly).
--
--  - export_frequency:
--      'daily'            : every day at the send time (today's behaviour).
--      'daily_if_changed' : every day at the send time, only if the spreadsheet data changed
--                           since the last successful send. Default for new rows.
--      'weekly'           : once a week on export_weekday at the send time, only if the data
--                           changed since the last successful send.
--  - export_weekday: 0 = Sunday ... 6 = Saturday, in the project's time zone. Required for weekly.
--  - export_last_sent_hash: SHA-256 of the spreadsheet's source data at the last send that
--    reached at least one recipient. Written only by send-project-export (service role); not
--    readable by app users. Null = never sent, so the next scheduled send always goes out.
--  - export_last_outcome / _at: what the last scheduled run did, for the settings status line.
--
-- Existing rows: every existing row is filled with 'daily' (ADD COLUMN default, no trigger
-- fires, no other column changes), so projects with the email on keep sending every day.
-- Then the default becomes 'daily_if_changed' and rows with the email OFF are moved to it,
-- so turning the email on later gets the new default.
--
-- The shared before-write trigger gains one line: turning the spreadsheet email on (again)
-- clears export_last_sent_hash, so the first send after that always goes out. Every other line
-- of the function is unchanged (the daily report settings use the same function).

begin;

alter table public.project_report_settings
  add column export_frequency text not null default 'daily',
  add column export_weekday smallint,
  add column export_last_sent_hash text,
  add column export_last_outcome text,
  add column export_last_outcome_at timestamptz;

alter table public.project_report_settings
  add constraint project_report_settings_export_frequency_check
    check (export_frequency in ('daily', 'daily_if_changed', 'weekly')),
  add constraint project_report_settings_export_weekday_check
    check (export_weekday is null or export_weekday between 0 and 6),
  add constraint project_report_settings_export_weekday_required
    check (export_frequency <> 'weekly' or export_weekday is not null),
  add constraint project_report_settings_export_last_outcome_check
    check (export_last_outcome is null or export_last_outcome in ('sent', 'skipped_no_changes', 'failed'));

alter table public.project_report_settings alter column export_frequency set default 'daily_if_changed';

update public.project_report_settings
   set export_frequency = 'daily_if_changed'
 where not export_email_enabled;

grant insert (export_frequency, export_weekday) on public.project_report_settings to authenticated;
grant update (export_frequency, export_weekday) on public.project_report_settings to authenticated;
grant select (export_frequency, export_weekday, export_last_outcome, export_last_outcome_at)
  on public.project_report_settings to authenticated;

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
    new.export_last_sent_hash := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

commit;
