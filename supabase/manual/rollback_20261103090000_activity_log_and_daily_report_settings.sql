-- ROLLBACK for 20261103090000_activity_log_and_daily_report_settings.sql
-- Run manually ONLY if the migration must be backed out. Removes every trigger, function
-- and table that migration added, and nothing else. Pre-existing objects (daily_reports,
-- its trigger, the notification triggers, is_project_member, ...) are not touched.
--
-- DESTRUCTIVE: drops activity_log, project_report_settings and project_report_recipients
-- with their data.
--
-- If the send-daily-reports cron job was registered, unschedule it first:
--   select cron.unschedule('send-daily-reports');

begin;

-- Triggers on pre-existing tables
drop trigger if exists log_task_activity on public.tasks;
drop trigger if exists log_checklist_item_activity on public.checklist_items;
drop trigger if exists log_task_photo_activity on public.task_photos;
drop trigger if exists log_task_comment_activity on public.task_comments;

-- New tables (their own triggers and policies go with them)
drop table if exists public.daily_report_test_sends;   -- from 20261104090000_daily_report_test_sends.sql
drop table if exists public.project_report_recipients;
drop table if exists public.project_report_settings;
drop table if exists public.activity_log;

-- Functions
drop function if exists public.log_task_activity();
drop function if exists public.log_checklist_item_activity();
drop function if exists public.log_task_photo_activity();
drop function if exists public.log_task_comment_activity();
drop function if exists public.project_report_settings_before_write();
drop function if exists public.project_report_recipients_before_insert();
drop function if exists public.can_manage_project_reports(uuid);
drop function if exists public.log_activity(uuid, uuid, uuid, text, uuid, text, text, text, text);
drop function if exists public.activity_quote(text);
drop function if exists public.activity_status_label(text, text);
drop function if exists public.activity_client_occurred_at();

commit;
