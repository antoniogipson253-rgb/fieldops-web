-- STEP (Phase 2 sweep item 3). complete_task_with_override and
-- convert_project_to_checklist both checked only that the caller was SOME
-- admin/PM somewhere, never that the target task/project belonged to that
-- caller's own company. An admin/PM of company A could complete any task, or
-- convert any project, belonging to company B.
--
-- Company is resolved the same way the rest of this codebase resolves it for
-- a project (projects has no company_id column): project.created_by ->
-- profiles.company_id. For a task, that's one extra join via tasks.project_id.
-- Same signatures, same return type (void), same existing admin/PM role check.

CREATE OR REPLACE FUNCTION public.complete_task_with_override(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_caller_company_id uuid;
  v_task_company_id uuid;
begin
  select company_id into v_caller_company_id
  from public.company_members
  where user_id = auth.uid() and role in ('admin', 'project_manager')
  limit 1;

  if v_caller_company_id is null then
    raise exception 'Only admins or project managers can override the checklist completion gate';
  end if;

  select prof.company_id into v_task_company_id
  from public.tasks t
  join public.projects proj on proj.id = t.project_id
  join public.profiles prof on prof.id = proj.created_by
  where t.id = p_task_id;

  if v_task_company_id is null or v_task_company_id <> v_caller_company_id then
    raise exception 'This task does not belong to your company';
  end if;

  perform set_config('app.checklist_override', 'true', true);
  update public.tasks set status = 'completed' where id = p_task_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.convert_project_to_checklist(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_caller_company_id uuid;
  v_project_company_id uuid;
begin
  select company_id into v_caller_company_id
  from public.company_members
  where user_id = auth.uid() and role = 'admin'
  limit 1;

  if v_caller_company_id is null then
    raise exception 'Only admins can convert a project';
  end if;

  select prof.company_id into v_project_company_id
  from public.projects proj
  join public.profiles prof on prof.id = proj.created_by
  where proj.id = p_project_id;

  if v_project_company_id is null or v_project_company_id <> v_caller_company_id then
    raise exception 'This project does not belong to your company';
  end if;

  update public.projects
    set project_type = 'checklist', converted_at = now()
    where id = p_project_id and project_type = 'regular';
end;
$function$;

-- ROLLBACK: re-run the two CREATE OR REPLACE FUNCTION statements exactly as
-- captured in C:\Users\anton\fieldops-backups\2026-11-23\schema-snapshot.sql
-- (pre-change source for both).
