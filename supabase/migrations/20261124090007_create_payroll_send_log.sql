-- PROPOSED ONLY. NOT APPLIED. Do not apply without separate approval.
--
-- payroll_send_log does not currently exist in the live database (confirmed via
-- information_schema.tables, 2026-11-24). automated-payroll-check/index.ts already
-- tries to insert into it after every send, but wraps that insert in
-- .then(()=>{}).catch(()=>{}) -- so every one of those inserts has been silently
-- failing, and there is currently NO duplicate-send protection at all. The cron job
-- fires every 15 minutes with a 14-minute match window, so a company whose schedule
-- falls near a 15-minute boundary could receive the same payroll report sent twice.
--
-- This migration only creates the table with a uniqueness guarantee. It does NOT
-- change automated-payroll-check/index.ts -- using this as a real guard still needs
-- a code change there: insert the (company_id, week_label) row BEFORE calling
-- send-payroll-report, with ON CONFLICT (company_id, week_label) DO NOTHING, and
-- only proceed to send if the insert actually affected a row. That code change is
-- not included here and has not been made.

CREATE TABLE IF NOT EXISTS public.payroll_send_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  week_label text NOT NULL,
  recipient_email text,
  status text NOT NULL DEFAULT 'success',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, week_label)
);

REVOKE ALL ON public.payroll_send_log FROM anon, authenticated, public;
GRANT ALL ON public.payroll_send_log TO service_role;

ALTER TABLE public.payroll_send_log ENABLE ROW LEVEL SECURITY;
-- No policies are created for anon/authenticated -- this table is written only by
-- the service role (via automated-payroll-check), and isn't meant to be read by
-- the client apps. RLS is enabled with zero policies so even if a future grant is
-- added by mistake, nothing is readable/writable without an explicit policy.

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.payroll_send_log;
