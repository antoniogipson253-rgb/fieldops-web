-- ROLLBACK for 20261118090000_daily_report_sends.sql
-- Run manually ONLY to back the archive out. Drops the daily_report_sends table (and every
-- archived report in it) and its writer function. Nothing else is touched: daily_reports,
-- project_report_settings, recipients, cron jobs and the spreadsheet export are unaffected.
--
-- BEFORE running: redeploy the previous send-daily-reports (git: the version before the
-- archive change). The new version tolerates a missing table (it logs the archive error and
-- still sends), but redeploying keeps the logs clean.
-- AFTER running: deploy a web build without the Daily Reports archive page, or the page will
-- show "Could not load reports".

begin;

drop function if exists public.record_daily_report_send(uuid, date, text, timestamptz, timestamptz, text[], text, text, text, jsonb, text);
drop table if exists public.daily_report_sends;   -- its policy goes with it

commit;
