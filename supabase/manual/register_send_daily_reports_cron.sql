-- NOT a migration. Run manually, once, AFTER:
--   1. 20261103090000_activity_log_and_daily_report_settings.sql is applied, and
--   2. the send-daily-reports edge function is deployed and verified via "Send test report to me".
--
-- Unlike the existing send-automated-payroll / send-missing-part-reminders jobs, the
-- bearer token is NOT embedded in the job text: it is read from vault at run time, the
-- same way the notification triggers do, so it never appears in cron.job.command.
--
-- timeout_milliseconds is raised from pg_net's 5s default so a slow run is not abandoned.

select cron.schedule(
  'send-daily-reports',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url')
           || '/functions/v1/send-daily-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- To remove:
-- select cron.unschedule('send-daily-reports');
