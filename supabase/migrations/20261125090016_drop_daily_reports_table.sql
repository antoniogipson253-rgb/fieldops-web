-- STEP (Item 2 follow-through, approved). Drops the legacy public.daily_reports
-- table, superseded by the project_report_settings/send-daily-reports system.
--
-- Pre-checks done before writing this file (2026-11-25):
--   - Backup file daily-reports-table-backup-2026-11-25.json confirmed present,
--     recorded row_count=1, matches the live table's current row count (1).
--   - pg_depend, cross-checked with an exact-substring scan (not a LIKE pattern,
--     which has an underscore-wildcard false-positive gotcha -- "daily_reports"
--     as a LIKE pattern also matches "daily-reports" with a hyphen) across every
--     function, view, other-table policy, other-table trigger, and cron job:
--     zero foreign keys from other tables point at this table; nothing beyond
--     its own 4 policies, its own trigger, and notify_daily_report_submitted()
--     references it anywhere.
--   - Full definition snapshot (table, constraints, indexes, policies, trigger,
--     function body) exported to
--     C:\Users\anton\fieldops-backups\2026-11-23\daily-reports-schema-snapshot-2026-11-25.sql.
--
-- The 1 real data row (project "MDA" per the earlier report) is NOT embedded in
-- this file or in rollback-2026-11-23.sql -- it contains real customer content.
-- A ready-to-run restore INSERT lives in the backup folder only, never the repo:
-- C:\Users\anton\fieldops-backups\2026-11-23\daily-reports-row-restore-2026-11-25.sql

BEGIN;

DROP TRIGGER IF EXISTS on_daily_report_submitted ON public.daily_reports;
DROP FUNCTION IF EXISTS public.notify_daily_report_submitted();

DROP POLICY IF EXISTS "Clients can view daily reports for their projects" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can create daily reports in their projects" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can update their own daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can view daily reports in their projects" ON public.daily_reports;

DROP TABLE public.daily_reports;

COMMIT;

-- ROLLBACK: see supabase/manual/rollback-2026-11-23.sql for the schema
-- recreation (table, constraints, policies, trigger, function). For the 1
-- data row, run the restore INSERT at
-- C:\Users\anton\fieldops-backups\2026-11-23\daily-reports-row-restore-2026-11-25.sql
-- (kept out of the repo deliberately -- real customer content).
