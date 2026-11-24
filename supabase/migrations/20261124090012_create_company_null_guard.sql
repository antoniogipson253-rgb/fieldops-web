-- STEP (Phase 2 sweep item 5, approved form). create_company was callable by
-- anon, and since company_members.user_id / companies.created_by are nullable
-- FK columns, a genuinely anonymous call (auth.uid() IS NULL) actually
-- succeeded -- creating a junk company and a company_members row with
-- user_id=NULL. Confirmed via git history that this RPC was called by real
-- mobile app code from its earliest tracked version through at least a point
-- in 1.5.5's development, so EXECUTE is kept for `authenticated` (and
-- `service_role`) -- only anon/public access is removed.

REVOKE EXECUTE ON FUNCTION public.create_company(text) FROM anon, public;

CREATE OR REPLACE FUNCTION public.create_company(company_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

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

-- ROLLBACK:
-- GRANT EXECUTE ON FUNCTION public.create_company(text) TO anon, public;
-- CREATE OR REPLACE FUNCTION public.create_company(company_name text)
-- RETURNS json
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $function$
-- declare
--   v_company_id uuid;
-- begin
--   insert into public.companies (name, created_by)
--   values (company_name, auth.uid())
--   returning id into v_company_id;
--
--   insert into public.company_members (company_id, user_id, role)
--   values (v_company_id, auth.uid(), 'admin');
--
--   update public.profiles
--   set company_id = v_company_id
--   where id = auth.uid();
--
--   return json_build_object('id', v_company_id, 'name', company_name);
-- end;
-- $function$;
-- (pre-change source also captured in
-- C:\Users\anton\fieldops-backups\2026-11-23\schema-snapshot.sql, line 1004)
