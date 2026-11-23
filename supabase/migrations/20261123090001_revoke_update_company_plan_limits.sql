-- PREPARED, NOT APPLIED. Apply order: FIRST of the two revokes (with 090002),
-- then test a Stripe test webhook event, before anything else in this batch.
--
-- update_company_plan_limits(uuid, text) had EXECUTE granted to anon,
-- authenticated, public with no internal auth check at all -- anyone could
-- set any company's plan/limits to anything, including 'enterprise', for free.
-- Its only legitimate caller is supabase/functions/stripe-webhook, which uses
-- the service-role key and is unaffected by this revoke.

REVOKE EXECUTE ON FUNCTION public.update_company_plan_limits(uuid, text) FROM anon, authenticated, public;

-- ROLLBACK:
-- GRANT EXECUTE ON FUNCTION public.update_company_plan_limits(uuid, text) TO anon, authenticated, public;

-- Affected flows: none found in either repo (confirmed via repo-wide grep) -- only
-- supabase/functions/stripe-webhook calls it, via the service-role key.
-- Test: Stripe Dashboard -> Webhooks -> Send test event -> confirm the company's
-- plan/limits still update, and check stripe-webhook's function logs for errors.
