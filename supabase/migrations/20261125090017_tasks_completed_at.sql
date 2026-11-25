-- STEP (feature/sheet-completed-and-missing, read-first done 2026-11-25). Additive only,
-- no backfill: tasks finished before this migration keep a NULL completed_at, by design.
--
-- Read-first findings:
--   - No existing completion timestamp on tasks (checked information_schema.columns: 16
--     columns, nothing like it).
--   - 7 existing triggers on public.tasks, all checked via pg_trigger/pg_get_triggerdef:
--     apply_folder_checklist_to_new_task (AFTER INSERT), log_task_activity (AFTER UPDATE OF
--     status, photo_urls, punch_list_photo), mark_export_dirty (AFTER I/U/D), on_task_status_change
--     -> notify_task_status_change() (AFTER UPDATE OF status), on_task_updated -> handle_updated_at()
--     (BEFORE UPDATE), tasks_checklist_completion_gate -> enforce_checklist_completion() (BEFORE
--     UPDATE, can abort the statement with errcode CHK01), tasks_is_punch_list_immutable (BEFORE
--     UPDATE OF is_punch_list). None of them touch a completion timestamp, and the new BEFORE
--     UPDATE OF status trigger below does not interfere with any of them: if
--     tasks_checklist_completion_gate aborts the statement, any value this trigger set is rolled
--     back with it, so firing order between BEFORE triggers doesn't matter here. No push
--     notification or email is sent by this trigger -- it only sets a column.
--   - completed_at is a DATE, not a timestamptz, to match due_date's type exactly (due_date has
--     zero timezone conversion anywhere in the export path -- it's used as-is). Computed as
--     (now() AT TIME ZONE 'America/Chicago')::date, the same fallback timezone already used
--     elsewhere in this codebase (project_report_settings.timezone defaults to it; there is no
--     company-level timezone column).
--   - WHEN (NEW.status IS DISTINCT FROM OLD.status) means this only fires on an actual status
--     change, and it unconditionally overwrites completed_at every time status enters/leaves
--     'completed' -- so reopen clears it, and finishing again naturally uses the latest date.

BEGIN;

ALTER TABLE public.tasks ADD COLUMN completed_at date;

CREATE OR REPLACE FUNCTION public.set_task_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.completed_at := (now() AT TIME ZONE 'America/Chicago')::date;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_set_completed_at
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.set_task_completed_at();

COMMIT;

-- ROLLBACK: see supabase/manual/rollback-2026-11-23.sql.
