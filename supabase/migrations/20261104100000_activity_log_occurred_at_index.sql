-- send-daily-reports now selects a project's report day by occurred_at (when the change
-- happened), not created_at. Additive only; no columns are dropped or changed.
create index if not exists activity_log_project_occurred_idx
  on public.activity_log(project_id, occurred_at);
