-- Project + Task Checklist feature (Phase 1: schema)
-- Adds a second project mode ("checklist") where tasks carry a parts/materials
-- checklist, task completion is gated on every checklist item being resolved,
-- and missing-part items feed the send-missing-part-reminders edge function.

-- projects: type + one-way conversion marker
alter table public.projects
  add column project_type text not null default 'regular'
    check (project_type in ('regular', 'checklist')),
  add column converted_at timestamptz;

-- checklist_items
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  item_text text not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'done', 'missing_part', 'part_received')),
  missing_since timestamptz,
  last_notified_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index checklist_items_task_id_idx on public.checklist_items(task_id);
create index checklist_items_status_idx on public.checklist_items(status) where status = 'missing_part';

alter table public.checklist_items enable row level security;

-- RLS mirrors the existing tasks policies: membership is via task_id -> tasks.project_id -> project_members
create policy "Users can view checklist items in their projects" on public.checklist_items
  for select using (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = checklist_items.task_id and pm.user_id = auth.uid()
  ));

create policy "Users can insert checklist items in their projects" on public.checklist_items
  for insert with check (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = checklist_items.task_id and pm.user_id = auth.uid()
  ));

create policy "Users can update checklist items in their projects" on public.checklist_items
  for update using (exists (
    select 1 from public.tasks t
    join public.project_members pm on pm.project_id = t.project_id
    where t.id = checklist_items.task_id and pm.user_id = auth.uid()
  ));

create policy "Admins and PMs can delete checklist items" on public.checklist_items
  for delete using (exists (
    select 1 from public.company_members cm
    where cm.user_id = auth.uid() and cm.role in ('admin', 'project_manager')
  ));

-- 45-item cap per task, DB-enforced (client also enforces this, this is the backstop)
create or replace function public.enforce_checklist_item_cap() returns trigger as $$
begin
  if (select count(*) from public.checklist_items where task_id = new.task_id) >= 45 then
    raise exception 'A task can have at most 45 checklist items';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger checklist_item_cap
  before insert on public.checklist_items
  for each row execute function public.enforce_checklist_item_cap();

-- missing_since bookkeeping: set when an item flips to missing_part, cleared on any other status
create or replace function public.set_checklist_missing_since() returns trigger as $$
begin
  if new.status = 'missing_part' and (old.status is distinct from 'missing_part') then
    new.missing_since := now();
  elsif new.status is distinct from 'missing_part' then
    new.missing_since := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger checklist_missing_since
  before insert or update on public.checklist_items
  for each row execute function public.set_checklist_missing_since();

-- Task completion gate for checklist-type projects: a task cannot become 'completed'
-- unless it has at least one checklist item AND every item is done/part_received.
-- Custom errcode 'CHK01' lets the frontend show a purpose-built message instead of
-- the generic Postgres error text, distinguishing this rejection from any other
-- update failure on the same mutation.
create or replace function public.enforce_checklist_completion() returns trigger as $$
declare
  ptype text;
  total_items int;
  unresolved int;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    select p.project_type into ptype from public.projects p where p.id = new.project_id;
    if ptype = 'checklist' then
      select count(*), count(*) filter (where status not in ('done', 'part_received'))
        into total_items, unresolved
        from public.checklist_items where task_id = new.id;
      if total_items = 0 then
        raise exception 'This task has no checklist items yet -- add at least one before marking it complete'
          using errcode = 'CHK01';
      elsif unresolved > 0 then
        raise exception 'Cannot complete task: % checklist item(s) still unresolved', unresolved
          using errcode = 'CHK01';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger tasks_checklist_completion_gate
  before update on public.tasks
  for each row execute function public.enforce_checklist_completion();

-- One-way conversion, admin-gated server-side. This bypasses the existing
-- "created_by = auth.uid()" restriction on the projects UPDATE RLS policy so that
-- ANY company admin can convert a project, not just the one who created it.
create or replace function public.convert_project_to_checklist(p_project_id uuid) returns void as $$
begin
  if not exists (
    select 1 from public.company_members where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Only admins can convert a project';
  end if;

  update public.projects
    set project_type = 'checklist', converted_at = now()
    where id = p_project_id and project_type = 'regular';
end;
$$ language plpgsql security definer set search_path = public;
