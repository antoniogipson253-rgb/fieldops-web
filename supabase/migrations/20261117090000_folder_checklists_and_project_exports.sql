-- Folder-wide checklists + per-project spreadsheet export.
--
-- A. Folder checklists (Tasks + Checklist projects only)
--    - folder_checklist_items: the folder's checklist (text + order), max 45 per folder.
--    - folders.checklist_managed: true once someone has saved the folder checklist. From then
--      on every task in the folder carries exactly the folder's items (linked through
--      checklist_items.folder_item_id); only ticks (status) vary per task.
--    - save_folder_checklist(folder, items, dry_run): ONE atomic RPC for add / rename /
--      delete / reorder / overwrite. dry_run returns the same counts without changing anything
--      (for the confirmation dialog).
--    - New tasks in a managed folder get the folder's items, all not done (any client: web,
--      Excel import, mobile, old app versions, the offline queue).
--    - Old clients stay safe in managed folders: an extra per-task item insert succeeds for the
--      client (the row is returned) and is removed at the end of the same statement; per-task
--      renames/reorders of shared items are kept at the folder's values. Ticks always work.
--
-- B. Spreadsheet export
--    - project_export_queue: marked dirty by triggers on every relevant change; a cron-driven
--      edge function rebuilds a project's file once it has been quiet for 30 s (or dirty for
--      90 s), so rapid taps produce one rebuild.
--    - Private storage bucket project-exports (<project_id>.xlsx), readable only by members of
--      the company that owns the project.
--    - project_report_settings gains the per-project spreadsheet-email switch (default OFF).
--    - project_export_test_sends: rate limit + audit for "send test spreadsheet".
--
-- Nothing here changes task statuses, the checklist completion gate, or the admin/PM
-- completion override. Runs as one transaction.

-- ===========================================================================
-- A. Folder checklists
-- ===========================================================================

alter table public.folders add column checklist_managed boolean not null default false;

create table public.folder_checklist_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  item_text text not null check (length(btrim(item_text)) between 1 and 200),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- deferrable so a swap of two names inside one save does not trip the constraint mid-way
  constraint folder_checklist_items_unique_text unique (folder_id, item_text) deferrable initially deferred
);
create index folder_checklist_items_folder_idx on public.folder_checklist_items(folder_id, sort_order);

alter table public.folder_checklist_items enable row level security;
create policy "Project members can view folder checklists" on public.folder_checklist_items
  for select using (exists (
    select 1 from public.folders f where f.id = folder_checklist_items.folder_id
      and (public.is_project_member(f.project_id, auth.uid()) or public.can_manage_project_reports(f.project_id))
  ));
-- Writes only through save_folder_checklist (SECURITY DEFINER).
revoke all on public.folder_checklist_items from anon, authenticated;
grant select on public.folder_checklist_items to authenticated;

alter table public.checklist_items
  add column folder_item_id uuid references public.folder_checklist_items(id) on delete cascade;
create index checklist_items_folder_item_idx on public.checklist_items(folder_item_id);

-- Is the current statement the folder-checklist sync itself? (set only by our SECURITY
-- DEFINER code; API clients cannot call set_config)
create or replace function public.folder_checklist_syncing() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.folder_checklist_sync', true), 'off') = 'on';
$$;

create or replace function public.task_folder_is_managed(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select f.checklist_managed from public.tasks t join public.folders f on f.id = t.folder_id
                   where t.id = p_task_id), false);
$$;

-- 45-item cap: unchanged for normal use. Skipped for a client insert into a managed folder,
-- because that row is removed again at the end of the statement (see below), so it can never
-- push a task over the cap, and rejecting it would surface an error in old app versions.
create or replace function public.enforce_checklist_item_cap() returns trigger as $$
begin
  if not public.folder_checklist_syncing() and public.task_folder_is_managed(new.task_id) then
    return new;
  end if;
  if (select count(*) from public.checklist_items where task_id = new.task_id) >= 45 then
    raise exception 'A task can have at most 45 checklist items';
  end if;
  return new;
end;
$$ language plpgsql;

-- Clients can never link/unlink items themselves, and cannot rename or reorder a shared item.
create or replace function public.checklist_items_folder_guard() returns trigger
language plpgsql as $$
begin
  if public.folder_checklist_syncing() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.folder_item_id := null;
  else
    if old.folder_item_id is not null then
      new.item_text := old.item_text;
      new.sort_order := old.sort_order;
      new.task_id := old.task_id;
    end if;
    new.folder_item_id := old.folder_item_id;
  end if;
  return new;
end;
$$;

create trigger checklist_items_folder_guard
  before insert or update on public.checklist_items
  for each row execute function public.checklist_items_folder_guard();

-- A client-inserted (unlinked) item on a task in a managed folder is removed at the end of the
-- statement. The INSERT's RETURNING has already been produced, so the client sees success.
create or replace function public.checklist_items_drop_unmanaged_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.folder_checklist_syncing() and new.folder_item_id is null
     and public.task_folder_is_managed(new.task_id) then
    delete from public.checklist_items where id = new.id;
  end if;
  return null;
exception when others then
  raise warning 'checklist_items_drop_unmanaged_extra: %', sqlerrm;
  return null;
end;
$$;

create trigger checklist_items_drop_unmanaged_extra
  after insert on public.checklist_items
  for each row execute function public.checklist_items_drop_unmanaged_extra();

-- folders.checklist_managed is set only by save_folder_checklist.
create or replace function public.folders_checklist_managed_guard() returns trigger
language plpgsql as $$
begin
  if not public.folder_checklist_syncing() then
    new.checklist_managed := case when tg_op = 'INSERT' then false else old.checklist_managed end;
  end if;
  return new;
end;
$$;

create trigger folders_checklist_managed_guard
  before insert or update on public.folders
  for each row execute function public.folders_checklist_managed_guard();

-- New task in a managed folder: give it the folder's items, all not done. Never blocks the
-- task insert itself (on failure the task is created without items and the next folder save
-- repairs it).
create or replace function public.apply_folder_checklist_to_new_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.folder_id is null then return null; end if;
  if not exists (select 1 from public.folders where id = new.folder_id and checklist_managed) then return null; end if;
  begin
    perform set_config('app.folder_checklist_sync', 'on', true);
    insert into public.checklist_items (task_id, item_text, sort_order, folder_item_id)
    select new.id, fi.item_text, fi.sort_order, fi.id
      from public.folder_checklist_items fi where fi.folder_id = new.folder_id
      order by fi.sort_order;
    perform set_config('app.folder_checklist_sync', 'off', true);
  exception when others then
    perform set_config('app.folder_checklist_sync', 'off', true);
    raise warning 'apply_folder_checklist_to_new_task: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger apply_folder_checklist_to_new_task
  after insert on public.tasks
  for each row execute function public.apply_folder_checklist_to_new_task();

-- 45 items per folder checklist.
create or replace function public.enforce_folder_checklist_cap() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.folder_checklist_items where folder_id = new.folder_id) > 45 then
    raise exception 'A folder checklist can have at most 45 items' using errcode = 'FCL04';
  end if;
  return null;
end;
$$;

create constraint trigger folder_checklist_cap
  after insert on public.folder_checklist_items
  deferrable initially immediate
  for each row execute function public.enforce_folder_checklist_cap();

-- ---------------------------------------------------------------------------
-- save_folder_checklist
--   p_items: JSON array in the new order, each {"id": <existing folder item id or null>, "text": "..."}
--   Items of the folder not present in p_items are deleted (and removed from every task).
-- Returns counts; with p_dry_run = true nothing is changed and the same counts are returned.
-- Errors: FCL01 not allowed, FCL02 invalid input, FCL03 not a Tasks + Checklist project,
--         FCL04 more than 45 items.
-- ---------------------------------------------------------------------------
create or replace function public.save_folder_checklist(p_folder_id uuid, p_items jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_ptype text;
  v_n int;
  v_el jsonb;
  v_pos int := 0;
  v_text text;
  v_id uuid;
  v_tasks int;
  v_touched int := 0;
  v_ticks_lost int := 0;
  v_missing_lost int := 0;
  v_added int := 0;
  v_renamed int := 0;
  v_deleted int := 0;
  v_was_managed boolean;
  r record;
begin
  select f.project_id, p.project_type, f.checklist_managed
    into v_project, v_ptype, v_was_managed
    from public.folders f join public.projects p on p.id = f.project_id
   where f.id = p_folder_id
   for update of f;
  if not found then
    raise exception 'Folder not found' using errcode = 'FCL02';
  end if;
  if not public.can_manage_project_reports(v_project) then
    raise exception 'Only company admins and project managers can edit a folder checklist' using errcode = 'FCL01';
  end if;
  if v_ptype is distinct from 'checklist' then
    raise exception 'Folder checklists are only available in Tasks + Checklist projects' using errcode = 'FCL03';
  end if;

  -- ---- validate input into a scratch table ----
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Items must be a list' using errcode = 'FCL02';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n > 45 then
    raise exception 'A folder checklist can have at most 45 items (got %)', v_n using errcode = 'FCL04';
  end if;

  create temp table if not exists _fcl_new (pos int, id uuid, txt text) on commit drop;
  create temp table if not exists _fcl_before (task_id uuid, id uuid, item_text text, sort_order int, status text) on commit drop;
  truncate _fcl_new; truncate _fcl_before;

  for v_el in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_text := btrim(coalesce(v_el->>'text', ''));
    if length(v_text) = 0 then
      raise exception 'Item % has no text', v_pos using errcode = 'FCL02';
    end if;
    if length(v_text) > 200 then
      raise exception 'Item % is longer than 200 characters', v_pos using errcode = 'FCL02';
    end if;
    v_id := null;
    if v_el ? 'id' and jsonb_typeof(v_el->'id') = 'string' then
      begin
        v_id := (v_el->>'id')::uuid;
      exception when others then
        raise exception 'Item % has an invalid id', v_pos using errcode = 'FCL02';
      end;
      if not exists (select 1 from public.folder_checklist_items where id = v_id and folder_id = p_folder_id) then
        raise exception 'Item % does not belong to this folder', v_pos using errcode = 'FCL02';
      end if;
    end if;
    insert into _fcl_new values (v_pos - 1, v_id, v_text);  -- 0-based, like existing sort_order
  end loop;

  if (select count(*) from _fcl_new) <> (select count(distinct txt) from _fcl_new) then
    raise exception 'Two items have the same name' using errcode = 'FCL02';
  end if;
  if (select count(*) from _fcl_new where id is not null) <> (select count(distinct id) from _fcl_new where id is not null) then
    raise exception 'The same item appears twice' using errcode = 'FCL02';
  end if;

  select count(*) into v_tasks from public.tasks where folder_id = p_folder_id;

  -- ---- do the work (inside a sub-block, so dry_run can undo it and keep the counts) ----
  begin
    perform set_config('app.folder_checklist_sync', 'on', true);

    insert into _fcl_before
      select c.task_id, c.id, c.item_text, c.sort_order, c.status
        from public.checklist_items c join public.tasks t on t.id = c.task_id
       where t.folder_id = p_folder_id;

    -- 1. folder items: delete removed ones (their task items go with them, ON DELETE CASCADE)
    delete from public.folder_checklist_items fi
     where fi.folder_id = p_folder_id
       and not exists (select 1 from _fcl_new n where n.id = fi.id);
    get diagnostics v_deleted = row_count;

    --    rename / reorder kept ones
    select count(*) into v_renamed
      from _fcl_new n join public.folder_checklist_items fi on fi.id = n.id
     where fi.item_text is distinct from n.txt;
    update public.folder_checklist_items fi
       set item_text = n.txt, sort_order = n.pos
      from _fcl_new n
     where n.id = fi.id and (fi.item_text is distinct from n.txt or fi.sort_order is distinct from n.pos);

    --    add new ones
    for r in select * from _fcl_new where id is null order by pos loop
      insert into public.folder_checklist_items (folder_id, item_text, sort_order)
      values (p_folder_id, r.txt, r.pos) returning id into v_id;
      update _fcl_new set id = v_id where pos = r.pos;
      v_added := v_added + 1;
    end loop;

    -- 2. every task in the folder: make its checklist exactly the folder's
    --    a) link unlinked items whose text matches a folder item exactly (keeps their tick)
    update public.checklist_items c
       set folder_item_id = m.folder_item_id
      from (
        select distinct on (c2.task_id, n.id) c2.id as item_id, n.id as folder_item_id
          from public.checklist_items c2
          join public.tasks t on t.id = c2.task_id and t.folder_id = p_folder_id
          join _fcl_new n on n.txt = c2.item_text
         where c2.folder_item_id is null
           and not exists (select 1 from public.checklist_items x where x.task_id = c2.task_id and x.folder_item_id = n.id)
         order by c2.task_id, n.id, c2.sort_order, c2.created_at
      ) m
     where c.id = m.item_id;

    --    b) remove everything that is not linked to a current folder item
    delete from public.checklist_items c
     using public.tasks t
     where t.id = c.task_id and t.folder_id = p_folder_id
       and (c.folder_item_id is null or not exists (select 1 from _fcl_new n where n.id = c.folder_item_id));

    --    c) shared text and order on every linked item
    update public.checklist_items c
       set item_text = n.txt, sort_order = n.pos
      from _fcl_new n, public.tasks t
     where c.folder_item_id = n.id and t.id = c.task_id and t.folder_id = p_folder_id
       and (c.item_text is distinct from n.txt or c.sort_order is distinct from n.pos);

    --    d) add missing items, not done
    insert into public.checklist_items (task_id, item_text, sort_order, folder_item_id)
    select t.id, n.txt, n.pos, n.id
      from public.tasks t cross join _fcl_new n
     where t.folder_id = p_folder_id
       and not exists (select 1 from public.checklist_items c where c.task_id = t.id and c.folder_item_id = n.id);

    update public.folders set checklist_managed = true where id = p_folder_id;

    -- ---- counts (before vs after, per item id) ----
    select count(*) filter (where b.status in ('done', 'part_received')),
           count(*) filter (where b.status = 'missing_part')
      into v_ticks_lost, v_missing_lost
      from _fcl_before b
     where not exists (select 1 from public.checklist_items c where c.id = b.id);

    select count(distinct task_id) into v_touched from (
      (select task_id, id, item_text, sort_order from _fcl_before
       except
       select c.task_id, c.id, c.item_text, c.sort_order from public.checklist_items c
         join public.tasks t on t.id = c.task_id where t.folder_id = p_folder_id)
      union all
      (select c.task_id, c.id, c.item_text, c.sort_order from public.checklist_items c
         join public.tasks t on t.id = c.task_id where t.folder_id = p_folder_id
       except
       select task_id, id, item_text, sort_order from _fcl_before)
    ) d;

    perform set_config('app.folder_checklist_sync', 'off', true);

    if p_dry_run then
      raise exception 'dry run' using errcode = 'FCLDR';
    end if;
  exception
    when sqlstate 'FCLDR' then
      perform set_config('app.folder_checklist_sync', 'off', true);
    when others then
      perform set_config('app.folder_checklist_sync', 'off', true);
      raise;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'tasks_in_folder', v_tasks,
    'tasks_touched', v_touched,
    'ticked_items_lost', v_ticks_lost,
    'missing_part_items_lost', v_missing_lost,
    'items_total', v_n,
    'items_added', v_added,
    'items_renamed', v_renamed,
    'items_deleted', v_deleted,
    'first_save', not v_was_managed
  );
end;
$$;

revoke execute on function public.save_folder_checklist(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_folder_checklist(uuid, jsonb, boolean) to authenticated;

-- ===========================================================================
-- B. Spreadsheet export
-- ===========================================================================

create table public.project_export_queue (
  project_id uuid primary key,          -- no FK on purpose: marking must never block a project delete
  dirty_at timestamptz not null default now(),
  first_dirty_at timestamptz not null default now(),
  last_built_at timestamptz,
  last_error text
);
alter table public.project_export_queue enable row level security;
revoke all on public.project_export_queue from anon, authenticated;

create or replace function public.mark_project_export_dirty(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_project_id is null then return; end if;
  insert into public.project_export_queue as q (project_id, dirty_at, first_dirty_at)
  values (p_project_id, now(), now())
  on conflict (project_id) do update
    set dirty_at = now(),
        first_dirty_at = case when q.last_built_at is not null and q.last_built_at >= q.dirty_at
                              then now() else q.first_dirty_at end;
exception when others then
  raise warning 'mark_project_export_dirty: %', sqlerrm;
end;
$$;
revoke execute on function public.mark_project_export_dirty(uuid) from public, anon, authenticated;

create or replace function public.trg_mark_export_dirty() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_json jsonb;
begin
  v_json := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name in ('tasks', 'folders') then
    v_project := (v_json->>'project_id')::uuid;
    if tg_op = 'UPDATE' and (to_jsonb(old)->>'project_id') is distinct from (v_json->>'project_id') then
      perform public.mark_project_export_dirty((to_jsonb(old)->>'project_id')::uuid);
    end if;
  elsif tg_table_name = 'projects' then
    v_project := (v_json->>'id')::uuid;
  elsif tg_table_name = 'checklist_items' then
    select project_id into v_project from public.tasks where id = (v_json->>'task_id')::uuid;
  elsif tg_table_name = 'folder_checklist_items' then
    select project_id into v_project from public.folders where id = (v_json->>'folder_id')::uuid;
  end if;
  perform public.mark_project_export_dirty(v_project);
  return null;
exception when others then
  raise warning 'trg_mark_export_dirty: %', sqlerrm;
  return null;
end;
$$;

create trigger mark_export_dirty after insert or update or delete on public.tasks
  for each row execute function public.trg_mark_export_dirty();
create trigger mark_export_dirty after insert or update or delete on public.checklist_items
  for each row execute function public.trg_mark_export_dirty();
create trigger mark_export_dirty after insert or update or delete on public.folders
  for each row execute function public.trg_mark_export_dirty();
create trigger mark_export_dirty after insert or update or delete on public.folder_checklist_items
  for each row execute function public.trg_mark_export_dirty();
create trigger mark_export_dirty after update of name on public.projects
  for each row execute function public.trg_mark_export_dirty();

-- Every existing project gets a first file on the first queue run.
insert into public.project_export_queue (project_id) select id from public.projects on conflict do nothing;

-- Who may read a project's export: members of the company that owns the project (the
-- project creator's company, as everywhere else in this app).
create or replace function public.can_read_project_export(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
      join public.profiles creator on creator.id = p.created_by
      join public.company_members cm on cm.company_id = creator.company_id
     where p.id = p_project_id and cm.user_id = auth.uid()
  );
$$;
revoke execute on function public.can_read_project_export(uuid) from public, anon;
grant execute on function public.can_read_project_export(uuid) to authenticated, service_role;

-- Object name "<project_id>.xlsx" -> project id (null for anything else).
create or replace function public.project_export_object_project(p_name text) returns uuid
language plpgsql immutable as $$
begin
  if p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.xlsx$' then
    return substring(p_name from 1 for 36)::uuid;
  end if;
  return null;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-exports', 'project-exports', false, 52428800,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "Company members can read their project exports" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-exports'
         and public.can_read_project_export(public.project_export_object_project(name)));
-- No insert/update/delete policies: only the service-role edge function writes this bucket.

-- Per-project spreadsheet email (default OFF), sent at the daily-report send time.
alter table public.project_report_settings
  add column export_email_enabled boolean not null default false,
  add column export_enabled_at timestamptz,
  add column export_last_sent_date date,
  add column export_last_sent_at timestamptz;

grant insert (export_email_enabled) on public.project_report_settings to authenticated;
grant update (export_email_enabled) on public.project_report_settings to authenticated;

create or replace function public.project_report_settings_before_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone: %', new.timezone using errcode = 'RPT04';
  end if;

  if new.enabled and (tg_op = 'INSERT' or not old.enabled) then
    new.last_report_cutoff := now();
  end if;

  -- First spreadsheet email (and the first after re-enabling) waits for the next send time.
  if new.export_email_enabled and (tg_op = 'INSERT' or not old.export_email_enabled) then
    new.export_enabled_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create table public.project_export_test_sends (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  sent_to text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index project_export_test_sends_project_created_idx on public.project_export_test_sends(project_id, created_at);
alter table public.project_export_test_sends enable row level security;
revoke all on public.project_export_test_sends from anon, authenticated;
