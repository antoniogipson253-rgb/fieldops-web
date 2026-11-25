-- PREPARED, NOT APPLIED. Backs the landing page's contact form (submit-contact
-- edge function, also prepared but not deployed). Service-role only: RLS is
-- enabled with zero policies, so no anon/authenticated role can read, insert,
-- update, or delete directly -- only the edge function's service-role client can.

BEGIN;

CREATE TABLE public.landing_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('call', 'feedback')),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  message text,
  ip_hash text,
  email_sent boolean NOT NULL DEFAULT false,
  user_agent text
);

ALTER TABLE public.landing_inquiries ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get zero access under RLS by default.
-- Only the service-role client (submit-contact edge function) can read/write.

-- Belt-and-suspenders alongside RLS: anon/authenticated get no table privileges at all, not
-- just "no rows via RLS." (service_role and postgres are unaffected -- REVOKE never touches
-- roles it isn't told to.)
REVOKE ALL ON public.landing_inquiries FROM anon, authenticated;

CREATE INDEX landing_inquiries_ip_hash_created_at_idx
  ON public.landing_inquiries (ip_hash, created_at);

COMMIT;

-- ROLLBACK: see supabase/manual/rollback-2026-11-23.sql.
