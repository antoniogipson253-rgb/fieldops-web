-- Pre-existing bug, discovered during multi-assignee live testing, not introduced by
-- the multi-assignee migration: notify_comment_added() built its net.http_post headers
-- as `'...' || secret || '...'::jsonb`. Postgres's `::` cast binds tighter than `||`,
-- so this cast only the trailing 2-character literal '"}' to jsonb (invalid JSON on its
-- own), not the full concatenated string -- meaning every comment-notification push call
-- has thrown since this trigger was first written, rolling back the entire
-- INSERT INTO task_comments (comments were silently never persisted via this path).
-- notify_task_assigned's original headers used jsonb_build_object(...) instead, which
-- doesn't have this precedence trap -- applying the same fix here.
create or replace function public.notify_comment_added() returns trigger as $$
DECLARE
  v_commenter_name text;
  v_task_title text;
  v_project_id uuid;
  v_assignee record;
BEGIN
  SELECT full_name INTO v_commenter_name
  FROM public.profiles WHERE id = NEW.user_id;
  v_commenter_name := COALESCE(v_commenter_name, 'Someone');

  SELECT title, project_id INTO v_task_title, v_project_id
  FROM public.tasks WHERE id = NEW.task_id;

  FOR v_assignee IN
    SELECT ta.user_id FROM public.task_assignees ta
    WHERE ta.task_id = NEW.task_id AND ta.user_id != NEW.user_id
  LOOP
    INSERT INTO public.notifications (user_id, title, body, task_id, project_id, read)
    VALUES (
      v_assignee.user_id,
      'New Comment',
      v_commenter_name || ' commented on: ' || v_task_title,
      NEW.task_id,
      v_project_id,
      false
    );

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/send-push-notification',
      body := json_build_object(
        'userId', v_assignee.user_id,
        'title', 'New Comment',
        'body', v_commenter_name || ' commented on: ' || v_task_title,
        'data', json_build_object('taskId', NEW.task_id, 'projectId', v_project_id)
      )::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ language plpgsql security definer;
