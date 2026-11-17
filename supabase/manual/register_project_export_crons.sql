-- NOT a migration. Step 3: run manually, once, only after your OK, after
--   1. 20261117090000_folder_checklists_and_project_exports.sql is applied, and
--   2. build-project-export and send-project-export are deployed and verified.
-- The bearer token is read from vault at run time (never stored in cron.job.command).

-- Debounced rebuild of stored spreadsheets: every minute; the function itself waits until a
-- project has been quiet for 30 s (or dirty for 90 s), so rapid changes produce one rebuild.
select cron.schedule(
  'build-project-exports',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url')
           || '/functions/v1/build-project-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{"mode":"queue"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- End-of-day spreadsheet email: every 15 minutes, acts only inside each enabled project's
-- send-time window (same send time / timezone / 2-hour window as the daily report).
select cron.schedule(
  'send-project-exports',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url')
           || '/functions/v1/send-project-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- To remove:
-- select cron.unschedule('build-project-exports');
-- select cron.unschedule('send-project-exports');
