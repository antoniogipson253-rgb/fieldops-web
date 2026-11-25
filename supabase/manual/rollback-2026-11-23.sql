-- Rollback file for the Step A security fixes, revised 2026-11-23 after the
-- recursion/scoping/casting corrections. Captured BEFORE any change was
-- applied. Each section corresponds to one of the split migration files in
-- supabase/migrations/20261123090001..090006_*.sql -- apply the matching
-- rollback section if that specific migration needs to be undone.
-- Nothing in this file has been run.

-- ============================================================
-- 090001: update_company_plan_limits(uuid, text)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.update_company_plan_limits(uuid, text) TO anon, authenticated, public;

-- ============================================================
-- 090002: cleanup_old_notifications()
-- ============================================================
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO anon, authenticated, public;

-- ============================================================
-- 090003: company_members DELETE policy + is_company_admin()
-- Pre-fix state: no is_company_admin function existed; the policy was:
-- ============================================================
DROP POLICY IF EXISTS "Users can delete company members" ON public.company_members;
CREATE POLICY "Users can delete company members" ON public.company_members
  FOR DELETE
  USING (is_company_member(company_id, auth.uid()));
DROP FUNCTION IF EXISTS public.is_company_admin(uuid, uuid);

-- ============================================================
-- 090004: user_presence SELECT policy
-- Pre-fix state: USING (true)
-- ============================================================
DROP POLICY IF EXISTS "Users can view presence" ON public.user_presence;
CREATE POLICY "Users can view presence" ON public.user_presence
  FOR SELECT
  USING (true);

-- ============================================================
-- 090005: storage.objects "Authenticated users can view project files"
-- Pre-fix state: bucket_id match + authenticated role only, no project scoping
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view project files" ON storage.objects;
CREATE POLICY "Authenticated users can view project files" ON storage.objects
  FOR SELECT
  USING ((bucket_id = 'project-files'::text) AND (auth.role() = 'authenticated'::text));

-- ============================================================
-- 090006: storage.objects "Authenticated users can view project photos" + helper
-- Pre-fix state: this policy and function did not exist at all.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can view project photos" ON storage.objects;
DROP FUNCTION IF EXISTS public.project_photo_project_id(text);

-- ============================================================
-- 090008: revoke anon/public EXECUTE on invite/lookup functions
-- Pre-fix state: EXECUTE granted to anon, authenticated, and public on all five.
-- ============================================================
GRANT EXECUTE ON FUNCTION public.invite_to_company(text, uuid) TO anon, public;
GRANT EXECUTE ON FUNCTION public.invite_to_company(text, uuid, text) TO anon, public;
GRANT EXECUTE ON FUNCTION public.invite_user_to_project(uuid, text, uuid) TO anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_members(uuid) TO anon, public;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO anon, public;

-- ============================================================
-- NOT INCLUDED in this batch -- task-photos' "Public can view photos" policy.
-- Deferred: that bucket is shared by six unrelated features (task_photos,
-- incident-report.tsx, budget.tsx expense receipts, change-orders.tsx,
-- rfi-log.tsx, chat.tsx, and avatars via useAvatarUpload.ts), several with no
-- project_id in their storage path and no tracking-table join available (e.g.
-- incident photos are stored at "incidents/<timestamp>.<ext>" with nothing to
-- scope against). All of them read via getPublicUrl(), not the authenticated
-- path this policy governs, so leaving the current policy in place is safe for
-- now -- but writing a correct replacement needs its own pass to map each
-- feature's access rule individually, not a single project-membership check
-- that would silently mishandle avatars/incidents/receipts. No file for this
-- is included in the current migration batch.

-- ============================================================
-- 090012: create_company(text) -- revoke anon/public + null guard
-- Pre-fix state: EXECUTE granted to anon, authenticated, public; no null check.
-- ============================================================
GRANT EXECUTE ON FUNCTION public.create_company(text) TO anon, public;
CREATE OR REPLACE FUNCTION public.create_company(company_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_company_id uuid;
begin
  insert into public.companies (name, created_by)
  values (company_name, auth.uid())
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, auth.uid(), 'admin');

  update public.profiles
  set company_id = v_company_id
  where id = auth.uid();

  return json_build_object('id', v_company_id, 'name', company_name);
end;
$function$;
-- (also captured verbatim in schema-snapshot.sql, line 1004)

-- ============================================================
-- create-company-bucket: undeployed 2026-11-24 (was version 2, verify_jwt=false)
-- Not a migration -- an edge function deploy/delete action. `supabase
-- functions delete` only removes the live deployment, never local source --
-- supabase/functions/create-company-bucket/index.ts is still in the working
-- tree, unchanged, same content first added at commit 57778b2.
-- To redeploy exactly as it was:
--   supabase functions deploy create-company-bucket --project-ref dpmlpqenanyoxfupferv --no-verify-jwt --use-api
-- (--no-verify-jwt matches its prior verify_jwt=false; omit it and the
-- deploy defaults to true, which would NOT match the original setting.)

-- ============================================================
-- build-project-export: web admin/PM gate (2026-11-25, branch web/export-admin-only)
-- Not a migration -- an edge function deploy + a web UI change. Pre-change
-- source is commit a63628a (supabase/functions/build-project-export/index.ts
-- and src/pages/ProjectDetailPage.tsx).
-- To roll back the function (verify_jwt stays true either way):
--   git show a63628a:supabase/functions/build-project-export/index.ts > supabase/functions/build-project-export/index.ts
--   supabase functions deploy build-project-export --project-ref dpmlpqenanyoxfupferv --use-api
-- To roll back the web UI (not deployed as of this entry -- only restore if
-- it was later deployed and needs reverting):
--   git show a63628a:src/pages/ProjectDetailPage.tsx > src/pages/ProjectDetailPage.tsx
-- (then rebuild/redeploy the web app through its normal path, e.g. a push to main)

-- ============================================================
-- 090014: project-exports storage read policy -- admin/PM only
-- Pre-fix state: "Company members can read their project exports" (any role).
-- ============================================================
DROP POLICY IF EXISTS "Admins and PMs can read their project exports" ON storage.objects;
CREATE POLICY "Company members can read their project exports" ON storage.objects
  FOR SELECT TO authenticated
  USING ((bucket_id = 'project-exports'::text) AND can_read_project_export(project_export_object_project(name)));
DROP FUNCTION IF EXISTS public.is_admin_or_pm_of_project(uuid);

-- ============================================================
-- build-project-export: mobile path role check rescoped (2026-11-25)
-- Not a migration -- function-only change. Pre-change source: commit e1e3a92
-- (supabase/functions/build-project-export/index.ts).
-- To roll back (verify_jwt stays true either way):
--   git show e1e3a92:supabase/functions/build-project-export/index.ts > supabase/functions/build-project-export/index.ts
--   supabase functions deploy build-project-export --project-ref dpmlpqenanyoxfupferv --use-api

-- ============================================================
-- 090015: profiles.email sync trigger
-- Pre-fix state: no trigger existed; profiles.email was set once at signup
-- and never updated again. 2 profiles had NULL email before the backfill.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
DROP FUNCTION IF EXISTS public.sync_profile_email();
-- The backfill is not reversible by dropping the trigger/function (it was a
-- one-time UPDATE). To restore the 2 profiles that were NULL before this ran,
-- see C:\Users\anton\fieldops-backups\2026-11-23\
-- profiles-email-backfill-changed-ids-2026-11-25.json for the exact ids, then:
--   UPDATE public.profiles SET email = NULL WHERE id IN (<ids from that file>);

-- ============================================================
-- 090016: drop daily_reports table (schema recreation only)
-- Pre-fix state: table existed with 4 policies, 1 trigger, 1 function, 1 row.
-- The 1 data row is NOT included here -- it is real customer content. See
-- C:\Users\anton\fieldops-backups\2026-11-23\daily-reports-row-restore-2026-11-25.sql
-- (not committed) to restore it, AFTER running the schema recreation below.
-- ============================================================
CREATE TABLE public.daily_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid,
  created_by uuid,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  weather text,
  created_at timestamp with time zone DEFAULT now(),
  issues text,
  crew_log text,
  photo_keys text[],
  updated_at timestamp with time zone DEFAULT now(),
  materials text,
  visible_to_client boolean NOT NULL DEFAULT false
);
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);
ALTER TABLE public.daily_reports ADD CONSTRAINT daily_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.daily_reports ADD CONSTRAINT daily_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE public.daily_reports ADD CONSTRAINT daily_reports_unique_per_day UNIQUE (project_id, created_by, report_date);

CREATE POLICY "Clients can view daily reports for their projects" ON public.daily_reports
  FOR SELECT USING (EXISTS (SELECT 1 FROM client_projects WHERE client_projects.project_id = daily_reports.project_id AND client_projects.client_id = auth.uid()));
CREATE POLICY "Users can create daily reports in their projects" ON public.daily_reports
  FOR INSERT WITH CHECK ((auth.uid() = created_by) AND EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = daily_reports.project_id AND project_members.user_id = auth.uid()));
CREATE POLICY "Users can update their own daily reports" ON public.daily_reports
  FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "Users can view daily reports in their projects" ON public.daily_reports
  FOR SELECT USING (is_project_member(project_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.notify_daily_report_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_author_name text;
  v_project_name text;
  v_recipient record;
BEGIN
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  SELECT full_name INTO v_author_name FROM public.profiles WHERE id = NEW.created_by;
  v_author_name := COALESCE(v_author_name, 'A team member');
  SELECT name INTO v_project_name FROM public.projects WHERE id = NEW.project_id;
  FOR v_recipient IN
    SELECT DISTINCT p.id AS user_id FROM public.profiles p
    WHERE p.role = 'admin' AND p.company_id = (SELECT company_id FROM public.profiles WHERE id = NEW.created_by) AND p.id != NEW.created_by
    UNION
    SELECT DISTINCT pm.user_id FROM public.project_members pm JOIN public.profiles p ON p.id = pm.user_id
    WHERE pm.project_id = NEW.project_id AND p.role IN ('project_manager', 'pm') AND pm.user_id != NEW.created_by
  LOOP
    INSERT INTO public.notifications (user_id, title, body, project_id, read)
    VALUES (v_recipient.user_id, 'Daily Report Submitted', v_author_name || ' submitted a daily report for ' || COALESCE(v_project_name, 'a project'), NEW.project_id, false);
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/send-push-notification',
      body := json_build_object('userId', v_recipient.user_id, 'title', 'Daily Report Submitted', 'body', v_author_name || ' submitted a daily report for ' || COALESCE(v_project_name, 'a project'), 'data', json_build_object('projectId', NEW.project_id))::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'))
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_daily_report_submitted
  AFTER INSERT OR UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION notify_daily_report_submitted();

-- ============================================================
-- 090017: tasks.completed_at + tasks_set_completed_at trigger
-- ============================================================
DROP TRIGGER IF EXISTS tasks_set_completed_at ON public.tasks;
DROP FUNCTION IF EXISTS public.set_task_completed_at();
ALTER TABLE public.tasks DROP COLUMN IF EXISTS completed_at;
