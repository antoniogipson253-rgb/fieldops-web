-- PREPARED, NOT APPLIED. Apply order: THIRD, after the two revokes have been
-- tested against a real Stripe webhook event.
--
-- Previously: "Users can delete company members" USING is_company_member(company_id,
-- auth.uid()) -- ANY member of a company (any role) could delete ANY OTHER
-- member's row, including admins. No role or ownership check at all.
--
-- A raw correlated subquery against company_members directly inside a policy
-- ON company_members risks "infinite recursion detected in policy for relation"
-- in Postgres. The existing (already-working) UPDATE policy on this table uses
-- a raw subquery and is fine in practice, but rather than gamble on that same
-- pattern for a new policy, this follows is_company_member()'s own proven-safe
-- shape instead: a STABLE SECURITY DEFINER function with a pinned search_path
-- (is_company_member itself lacks a pinned search_path -- fixing forward here,
-- not copying that gap into a new function).

CREATE OR REPLACE FUNCTION public.is_company_admin(p_company_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $f$
  select exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = p_user_id and role = 'admin'
  );
$f$;

DROP POLICY IF EXISTS "Users can delete company members" ON public.company_members;
CREATE POLICY "Users can delete company members" ON public.company_members
  FOR DELETE
  USING ( (user_id = auth.uid()) OR is_company_admin(company_id, auth.uid()) );

-- ROLLBACK:
-- DROP POLICY IF EXISTS "Users can delete company members" ON public.company_members;
-- CREATE POLICY "Users can delete company members" ON public.company_members
--   FOR DELETE USING (is_company_member(company_id, auth.uid()));
-- DROP FUNCTION IF EXISTS public.is_company_admin(uuid, uuid);

-- TESTED 2026-11-23, inside a transaction that was rolled back afterward (this
-- exact function + policy were created, exercised, then the whole transaction
-- was rolled back -- nothing here was ever committed before this file existed):
--   Scenario 1 -- SnT admin (ae8ac5e5-...) deletes another member: ALLOWED (1 row deleted)
--   Scenario 2 -- SnT worker (6f350e53-...) deletes another member: DENIED (0 rows)
--   Scenario 3 -- SnT worker (c59c2261-...) deletes their own row: ALLOWED (1 row deleted)
--   Scenario 4 -- admin of a DIFFERENT company (95de99f7-..., Great Scott Plumbing)
--     attempts to delete an SnT admin: DENIED (0 rows)
-- No recursion error occurred in any scenario.
--
-- Affected flows: none -- both apps already client-side gate "Remove member" to
-- admins only, so no legitimate flow relied on a non-admin removing someone else.
-- Confirm separately whether a self-service "leave company" feature exists or is
-- wanted; the `user_id = auth.uid()` clause enables it either way.
-- Test after applying for real: as an admin, remove another member (should still
-- work); as a non-admin, attempt to remove someone else via a direct API call,
-- not the UI since the UI already blocks it (should now be rejected); as any
-- member, delete your own row (should succeed).
