-- Admin/PM override for the checklist completion gate (CHK01).
-- The gate itself is unchanged for everyone else; this adds a narrow, explicit,
-- role-gated escape hatch for cases where a task legitimately doesn't need a
-- checklist (or a project was converted to checklist-type by mistake).

-- 1. Teach the completion trigger to respect a session-local override flag.
-- current_setting(..., true) with missing_ok=true returns NULL instead of erroring
-- when the setting was never configured on this connection, which is the normal case.
create or replace function public.enforce_checklist_completion() returns trigger as $$
declare
  ptype text;
  total_items int;
  unresolved int;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    if coalesce(current_setting('app.checklist_override', true), 'false') = 'true' then
      return new;
    end if;

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

-- 2. RPC that flips the override flag for this transaction only, then completes
-- the task. set_config(..., true) scopes the setting to the current transaction,
-- so it can never leak into any other statement or connection.
create or replace function public.complete_task_with_override(p_task_id uuid) returns void as $$
begin
  if not exists (
    select 1 from public.company_members
    where user_id = auth.uid() and role in ('admin', 'project_manager')
  ) then
    raise exception 'Only admins or project managers can override the checklist completion gate';
  end if;

  perform set_config('app.checklist_override', 'true', true);
  update public.tasks set status = 'completed' where id = p_task_id;
end;
$$ language plpgsql security definer set search_path = public;
