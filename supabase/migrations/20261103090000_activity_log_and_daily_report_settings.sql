-- Automatic daily report, Phase 1: activity log + per-project report settings.
--
-- 1. activity_log: written ONLY by SECURITY DEFINER triggers on tasks, checklist_items,
--    task_photos and task_comments. Covers web, mobile and offline replays alike.
--    No backfill: the log starts recording when this migration is applied.
-- 2. project_report_settings / project_report_recipients: edited by company admins and
--    project managers of the company that owns the project (RLS-enforced).
--
-- Nothing here touches daily_reports, its RLS, or its trigger. No existing table gains or
-- loses a column, so writes from older app versions are unaffected.
--
-- Logging must never break the write it observes: every logging path swallows its own
-- errors (raise warning) instead of failing the user's INSERT/UPDATE.

-- ---------------------------------------------------------------------------
-- activity_log
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,  -- null = System
  entity_type text not null
    check (entity_type in ('task', 'punch_item', 'checklist_item', 'photo', 'comment')),
  entity_id uuid,
  action_type text not null
    check (action_type in (
      'task_created', 'task_status_changed',
      'punch_item_created', 'punch_item_status_changed',
      'checklist_item_status_changed',
      'photo_uploaded', 'comment_added'
    )),
  old_value text,
  new_value text,
  description text not null,
  -- When the user actually did it: the optional x-client-occurred-at request header
  -- (sent by offline replays, Phase 2 mobile), clamped to [now() - 72h, now()].
  occurred_at timestamptz not null default now(),
  -- When the server recorded it. Report windows select on this column so a late
  -- offline replay is never skipped; occurred_at is what the report displays.
  created_at timestamptz not null default now()
);

create index activity_log_project_created_idx on public.activity_log(project_id, created_at);
create index activity_log_task_id_idx on public.activity_log(task_id);

alter table public.activity_log enable row level security;

create policy "Project members can read the activity log" on public.activity_log
  for select using (public.is_project_member(project_id, auth.uid()));

-- No insert/update/delete policies, and no write privileges for API roles.
revoke all on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- ---------------------------------------------------------------------------
-- Logging helpers
-- ---------------------------------------------------------------------------

-- Client-claimed time of the action, from the optional x-client-occurred-at header
-- (ISO 8601 with offset, e.g. 2026-11-03T21:14:05.123Z). PostgREST exposes request
-- headers as the request.headers setting (lower-cased names). Missing, unparseable,
-- or out-of-range values fall back to / are clamped into [now() - 72h, now()].
create or replace function public.activity_client_occurred_at() returns timestamptz
language plpgsql stable set search_path = public as $$
declare
  v_raw text;
  v_ts timestamptz;
begin
  begin
    v_raw := nullif(current_setting('request.headers', true), '')::json ->> 'x-client-occurred-at';
    if v_raw is not null then
      v_ts := v_raw::timestamptz;
    end if;
  exception when others then
    v_ts := null;
  end;

  if v_ts is null then
    return now();
  end if;
  return least(greatest(v_ts, now() - interval '72 hours'), now());
end;
$$;

create or replace function public.activity_status_label(p_kind text, p_status text) returns text
language sql immutable as $$
  select case
    when p_status is null then 'None'
    when p_kind = 'checklist_item' then case p_status
      when 'not_started' then 'Not Started'
      when 'done' then 'Done'
      when 'missing_part' then 'Missing Part'
      when 'part_received' then 'Part Received'
      else p_status end
    else case p_status
      when 'open' then 'Open'
      when 'in_progress' then 'In Progress'
      when 'completed' then 'Completed'
      else p_status end
  end;
$$;

-- 'Wire panel' (truncated to 120 chars). HTML escaping happens at render time, not here.
create or replace function public.activity_quote(p_text text) returns text
language sql immutable as $$
  select '''' ||
    case when length(coalesce(p_text, '')) = 0 then '(untitled)'
         when length(p_text) > 120 then left(p_text, 117) || '...'
         else p_text end
    || '''';
$$;

-- The single write path into activity_log. Not callable by API roles (see revoke below),
-- only by the SECURITY DEFINER trigger functions.
create or replace function public.log_activity(
  p_project_id uuid,
  p_task_id uuid,
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action_type text,
  p_old_value text,
  p_new_value text,
  p_description text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := p_actor_id;
begin
  if p_project_id is null then
    return;
  end if;

  -- Never let a dangling actor id fail the FK (and with it the user's write).
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    v_actor := null;
  end if;

  insert into public.activity_log (
    project_id, task_id, actor_id, entity_type, entity_id, action_type,
    old_value, new_value, description, occurred_at
  ) values (
    p_project_id, p_task_id, v_actor, p_entity_type, p_entity_id, p_action_type,
    p_old_value, p_new_value, p_description, public.activity_client_occurred_at()
  );
exception when others then
  raise warning 'activity_log insert failed (%): %', p_action_type, sqlerrm;
end;
$$;

revoke execute on function public.log_activity(uuid, uuid, uuid, text, uuid, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- Actor = auth.uid() (the signed-in caller, also inside SECURITY DEFINER), falling back
-- to the row's own author column where one exists. Service role / cron writes with no
-- such column are logged with actor_id null ("System").
-- ---------------------------------------------------------------------------

-- tasks: creation, status changes, and photos added via tasks.photo_urls (mobile punch
-- list) or tasks.punch_list_photo (web punch list). Punch items are tasks with
-- is_punch_list = true and are logged under their own entity/action types.
create or replace function public.log_task_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_is_punch boolean := coalesce(new.is_punch_list, false);
  v_kind text := case when coalesce(new.is_punch_list, false) then 'punch_item' else 'task' end;
  v_noun text := case when coalesce(new.is_punch_list, false) then 'punch item ' else '' end;
  v_actor uuid := auth.uid();
  v_photos_added int := 0;
  i int;
begin
  if tg_op = 'INSERT' then
    v_actor := coalesce(v_actor, new.created_by);
    perform public.log_activity(
      new.project_id, new.id, v_actor, v_kind, new.id, v_kind || '_created',
      null, new.status,
      'created ' || case when v_is_punch then 'punch item ' else 'task ' end || public.activity_quote(new.title)
    );

    v_photos_added := coalesce(cardinality(new.photo_urls), 0)
      + case when coalesce(new.punch_list_photo, '') <> '' then 1 else 0 end;
  else
    if new.status is distinct from old.status then
      perform public.log_activity(
        new.project_id, new.id, v_actor, v_kind, new.id, v_kind || '_status_changed',
        old.status, new.status,
        'marked ' || v_noun || public.activity_quote(new.title) || ' '
          || public.activity_status_label(v_kind, new.status)
          || ' (was ' || public.activity_status_label(v_kind, old.status) || ')'
      );
    end if;

    select count(*) into v_photos_added
      from unnest(coalesce(new.photo_urls, '{}'::text[])) as u(url)
      where not (u.url = any(coalesce(old.photo_urls, '{}'::text[])));

    if coalesce(new.punch_list_photo, '') <> ''
       and new.punch_list_photo is distinct from old.punch_list_photo then
      v_photos_added := v_photos_added + 1;
    end if;
  end if;

  for i in 1 .. v_photos_added loop
    perform public.log_activity(
      new.project_id, new.id, v_actor, 'photo', new.id, 'photo_uploaded',
      null, null,
      'uploaded a photo to ' || v_noun || public.activity_quote(new.title)
    );
  end loop;

  return null;
exception when others then
  raise warning 'log_task_activity failed: %', sqlerrm;
  return null;
end;
$$;

create trigger log_task_activity
  after insert or update of status, photo_urls, punch_list_photo on public.tasks
  for each row execute function public.log_task_activity();

-- checklist_items: every status change (Done, Missing Part, Part Received, Not Started).
create or replace function public.log_checklist_item_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task record;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  select id, title, project_id into v_task from public.tasks where id = new.task_id;

  perform public.log_activity(
    v_task.project_id, new.task_id, auth.uid(), 'checklist_item', new.id, 'checklist_item_status_changed',
    old.status, new.status,
    'marked ' || public.activity_quote(new.item_text) || ' '
      || public.activity_status_label('checklist_item', new.status)
      || ' on ' || public.activity_quote(v_task.title)
      || ' (was ' || public.activity_status_label('checklist_item', old.status) || ')'
  );
  return null;
exception when others then
  raise warning 'log_checklist_item_activity failed: %', sqlerrm;
  return null;
end;
$$;

create trigger log_checklist_item_activity
  after update of status on public.checklist_items
  for each row execute function public.log_checklist_item_activity();

-- task_photos: one row per uploaded photo (mobile task photos, offline photo queue, markup).
create or replace function public.log_task_photo_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task record;
begin
  select id, title, project_id, is_punch_list into v_task from public.tasks where id = new.task_id;

  perform public.log_activity(
    v_task.project_id, new.task_id, coalesce(auth.uid(), new.uploaded_by), 'photo', new.id, 'photo_uploaded',
    null, null,
    'uploaded a photo to ' || case when coalesce(v_task.is_punch_list, false) then 'punch item ' else '' end
      || public.activity_quote(v_task.title)
  );
  return null;
exception when others then
  raise warning 'log_task_photo_activity failed: %', sqlerrm;
  return null;
end;
$$;

create trigger log_task_photo_activity
  after insert on public.task_photos
  for each row execute function public.log_task_photo_activity();

-- task_comments: comment added. The comment body is deliberately not copied into the log.
create or replace function public.log_task_comment_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task record;
begin
  select id, title, project_id, is_punch_list into v_task from public.tasks where id = new.task_id;

  perform public.log_activity(
    v_task.project_id, new.task_id, coalesce(auth.uid(), new.user_id), 'comment', new.id, 'comment_added',
    null, null,
    'commented on ' || case when coalesce(v_task.is_punch_list, false) then 'punch item ' else '' end
      || public.activity_quote(v_task.title)
  );
  return null;
exception when others then
  raise warning 'log_task_comment_activity failed: %', sqlerrm;
  return null;
end;
$$;

create trigger log_task_comment_activity
  after insert on public.task_comments
  for each row execute function public.log_task_comment_activity();

-- ---------------------------------------------------------------------------
-- Who may manage report settings: company_members.role in ('admin','project_manager')
-- in the company that owns the project. projects has no company_id, so the owning
-- company is the creator's profiles.company_id (same rule send-missing-part-reminders uses).
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_project_reports(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.projects p
    join public.profiles creator on creator.id = p.created_by
    join public.company_members cm on cm.company_id = creator.company_id
    where p.id = p_project_id
      and cm.user_id = auth.uid()
      and cm.role in ('admin', 'project_manager')
  );
$$;

revoke execute on function public.can_manage_project_reports(uuid) from public, anon;
grant execute on function public.can_manage_project_reports(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- project_report_settings
-- ---------------------------------------------------------------------------
create table public.project_report_settings (
  project_id uuid primary key references public.projects(id) on delete cascade,
  enabled boolean not null default false,
  send_time time not null default '17:00',
  timezone text not null default 'America/Chicago',
  -- Start of the next report's window. Set to now() whenever the setting is switched on;
  -- advanced by the send-daily-reports function only (API roles cannot write it).
  last_report_cutoff timestamptz,
  -- Local calendar date (in `timezone`) of the scheduled send last handled (sent, or
  -- skipped for zero activity). Duplicate-send guard only; the report window itself is
  -- driven by last_report_cutoff. Written by the edge function only.
  last_sent_date date,
  -- Informational, for the settings UI ("Last sent ...").
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.project_report_settings_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = 'RPT04';
  end if;

  -- First report (and the first after re-enabling) starts at the moment it was turned on,
  -- so a re-enable does not dump everything since the last send weeks ago.
  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.last_report_cutoff := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger project_report_settings_before_write
  before insert or update on public.project_report_settings
  for each row execute function public.project_report_settings_before_write();

alter table public.project_report_settings enable row level security;

create policy "Admins and PMs can view report settings" on public.project_report_settings
  for select using (public.can_manage_project_reports(project_id));

create policy "Admins and PMs can create report settings" on public.project_report_settings
  for insert with check (public.can_manage_project_reports(project_id));

create policy "Admins and PMs can update report settings" on public.project_report_settings
  for update using (public.can_manage_project_reports(project_id))
  with check (public.can_manage_project_reports(project_id));

-- Column-level grants: clients can only write the user-facing settings. The cutoff and
-- last_sent_date / last_sent_at are owned by the trigger above and the service-role edge function.
revoke all on public.project_report_settings from anon, authenticated;
grant select on public.project_report_settings to authenticated;
grant insert (project_id, enabled, send_time, timezone) on public.project_report_settings to authenticated;
grant update (enabled, send_time, timezone) on public.project_report_settings to authenticated;

-- ---------------------------------------------------------------------------
-- project_report_recipients
-- ---------------------------------------------------------------------------
create table public.project_report_recipients (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  email text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_report_recipients_one_target check (num_nonnulls(user_id, email) = 1),
  constraint project_report_recipients_user_unique unique (project_id, user_id)
);

create unique index project_report_recipients_email_unique
  on public.project_report_recipients(project_id, lower(email))
  where email is not null;

create index project_report_recipients_project_idx on public.project_report_recipients(project_id);

-- 25-recipient sanity cap (serialised per project so two concurrent adds cannot both
-- pass the count), email normalisation/validation, and user recipients must belong to
-- the project or to the project's company.
create or replace function public.project_report_recipients_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('project_report_recipients:' || new.project_id::text, 0));

  if (select count(*) from public.project_report_recipients where project_id = new.project_id) >= 25 then
    raise exception 'This project already has the maximum of 25 report recipients'
      using errcode = 'RPT01';
  end if;

  if new.email is not null then
    new.email := lower(btrim(new.email));
    if new.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Invalid email address' using errcode = 'RPT02';
    end if;
  end if;

  if new.user_id is not null and not (
    exists (select 1 from public.project_members pm
            where pm.project_id = new.project_id and pm.user_id = new.user_id)
    or exists (select 1 from public.projects p
               join public.profiles creator on creator.id = p.created_by
               join public.company_members cm on cm.company_id = creator.company_id
               where p.id = new.project_id and cm.user_id = new.user_id)
  ) then
    raise exception 'Recipient must be a member of this project or its company'
      using errcode = 'RPT03';
  end if;

  return new;
end;
$$;

create trigger project_report_recipients_before_insert
  before insert on public.project_report_recipients
  for each row execute function public.project_report_recipients_before_insert();

alter table public.project_report_recipients enable row level security;

create policy "Admins and PMs can view report recipients" on public.project_report_recipients
  for select using (public.can_manage_project_reports(project_id));

create policy "Admins and PMs can add report recipients" on public.project_report_recipients
  for insert with check (public.can_manage_project_reports(project_id));

create policy "Admins and PMs can remove report recipients" on public.project_report_recipients
  for delete using (public.can_manage_project_reports(project_id));

-- Recipients are add/remove only (no update path).
revoke all on public.project_report_recipients from anon, authenticated;
grant select, delete on public.project_report_recipients to authenticated;
grant insert (project_id, user_id, email) on public.project_report_recipients to authenticated;
