-- Multi-assignee, step 2 of 2 (destructive — run only after step 1 has been
-- applied and verified). Rewrites the three notification triggers to fan out
-- over task_assignees instead of a single tasks.assigned_to, then drops the
-- old column and its FK.
--
-- The DO block below is a hard, automated version of the "row counts match"
-- check requested before dropping anything: it aborts the whole migration
-- (nothing after it applies, since db query -f runs the file in one
-- transaction) if the number of previously-non-null assigned_to values
-- doesn't exactly match the number of rows that made it into task_assignees.

do $$
declare
  v_old_count int;
  v_new_count int;
begin
  select count(*) into v_old_count from public.tasks where assigned_to is not null;
  select count(*) into v_new_count from public.task_assignees;

  if v_old_count <> v_new_count then
    raise exception 'task_assignees row count (%) does not match tasks.assigned_to non-null count (%) -- aborting before dropping the column', v_new_count, v_old_count;
  end if;
end $$;

-- --- notify_task_status_change: assignee half becomes a fan-out over task_assignees ---
create or replace function public.notify_task_status_change() returns trigger as $$
declare
  v_changer_name text;
  v_status_label text;
begin
  if OLD.status = NEW.status then
    return new;
  end if;

  select full_name into v_changer_name
  from public.profiles
  where id = auth.uid();

  v_changer_name := coalesce(v_changer_name, 'Someone');

  v_status_label := case new.status
    when 'in_progress' then 'In Progress'
    when 'completed' then 'Done'
    when 'open' then 'Open'
    else new.status
  end;

  insert into public.notifications (user_id, title, body, task_id, project_id, read)
  select ta.user_id,
    'Task Updated',
    v_changer_name || ' marked "' || new.title || '" as ' || v_status_label,
    new.id,
    new.project_id,
    false
  from public.task_assignees ta
  where ta.task_id = new.id
  and ta.user_id != auth.uid();

  insert into public.notifications (user_id, title, body, task_id, project_id, read)
  select cm.user_id,
    'Task Updated',
    v_changer_name || ' marked "' || new.title || '" as ' || v_status_label,
    new.id,
    new.project_id,
    false
  from public.company_members cm
  where cm.company_id = (
    select company_id from public.profiles where id = auth.uid()
  )
  and cm.role = 'admin'
  and cm.user_id != auth.uid();

  return new;
end;
$$ language plpgsql security definer;

-- --- notify_task_assigned: was AFTER INSERT OR UPDATE OF assigned_to ON tasks.
-- Becomes AFTER INSERT ON task_assignees, firing once per newly-added assignee. ---
drop trigger if exists on_task_assigned on public.tasks;
drop function if exists public.notify_task_assigned();

create or replace function public.notify_task_assignee_added() returns trigger as $$
declare
  v_assigner_name text;
  v_task_title text;
  v_project_id uuid;
begin
  select full_name into v_assigner_name
  from public.profiles where id = auth.uid();
  v_assigner_name := coalesce(v_assigner_name, 'Someone');

  select title, project_id into v_task_title, v_project_id
  from public.tasks where id = new.task_id;

  insert into public.notifications (user_id, title, body, task_id, project_id, read)
  values (
    new.user_id,
    'New Task Assigned',
    v_assigner_name || ' assigned you: ' || v_task_title,
    new.task_id,
    v_project_id,
    false
  );

  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/send-push-notification',
    body := json_build_object(
      'userId', new.user_id,
      'title', 'New Task Assigned',
      'body', v_assigner_name || ' assigned you: ' || v_task_title,
      'data', json_build_object('taskId', new.task_id, 'projectId', v_project_id)
    )::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    )
  );

  return new;
end;
$$ language plpgsql security definer;

create trigger on_task_assignee_added
  after insert on public.task_assignees
  for each row execute function public.notify_task_assignee_added();

-- --- notify_comment_added: loop over every current assignee instead of one ---
create or replace function public.notify_comment_added() returns trigger as $$
declare
  v_commenter_name text;
  v_task_title text;
  v_project_id uuid;
  v_assignee record;
begin
  select full_name into v_commenter_name
  from public.profiles where id = NEW.user_id;
  v_commenter_name := coalesce(v_commenter_name, 'Someone');

  select title, project_id into v_task_title, v_project_id
  from public.tasks where id = NEW.task_id;

  for v_assignee in
    select ta.user_id from public.task_assignees ta
    where ta.task_id = NEW.task_id and ta.user_id != NEW.user_id
  loop
    insert into public.notifications (user_id, title, body, task_id, project_id, read)
    values (
      v_assignee.user_id,
      'New Comment',
      v_commenter_name || ' commented on: ' || v_task_title,
      NEW.task_id,
      v_project_id,
      false
    );

    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/send-push-notification',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') || '"}'::jsonb,
      body := json_build_object(
        'userId', v_assignee.user_id,
        'title', 'New Comment',
        'body', v_commenter_name || ' commented on: ' || v_task_title,
        'data', json_build_object('taskId', NEW.task_id, 'projectId', v_project_id)
      )::text
    );
  end loop;

  return new;
end;
$$ language plpgsql security definer;

-- --- Finally, drop the old single-assignee column and its FK ---
alter table public.tasks drop column assigned_to;
