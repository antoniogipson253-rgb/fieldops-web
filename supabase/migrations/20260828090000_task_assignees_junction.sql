-- Multi-assignee, step 1 of 2 (additive/non-destructive).
-- Introduces task_assignees as a junction table alongside the existing
-- tasks.assigned_to column, and copies existing single-assignee data into it.
-- tasks.assigned_to is NOT touched or dropped by this file — see
-- 20260828091000_task_assignees_drop_old_column.sql for that step, which is
-- meant to run separately, after this one has been verified.

create table public.task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, user_id)
);

create index task_assignees_task_id_idx on public.task_assignees(task_id);
create index task_assignees_user_id_idx on public.task_assignees(user_id);

alter table public.task_assignees enable row level security;

-- Mirrors the existing "Users can update tasks in their projects" policy on tasks
-- (project_members membership, no role restriction) rather than checklist_items'
-- admin/PM-gated delete — assigning/unassigning today has zero DB-level role
-- restriction (only an app-layer UI gate), so this preserves that exact permission
-- shape for the column it's replacing.
create policy "Users can view assignees in their projects" on public.task_assignees
  for select using (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = task_assignees.task_id and pm.user_id = auth.uid()
  ));

create policy "Users can add assignees in their projects" on public.task_assignees
  for insert with check (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = task_assignees.task_id and pm.user_id = auth.uid()
  ));

create policy "Users can remove assignees in their projects" on public.task_assignees
  for delete using (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = task_assignees.task_id and pm.user_id = auth.uid()
  ));

-- Copy every existing single assignee into the junction table.
insert into public.task_assignees (task_id, user_id)
select id, assigned_to from public.tasks where assigned_to is not null
on conflict (task_id, user_id) do nothing;
