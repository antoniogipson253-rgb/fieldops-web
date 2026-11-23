-- PREPARED, NOT APPLIED. Apply order: SECOND of the two revokes (with 090001),
-- then test a Stripe test webhook event, before anything else in this batch.
--
-- cleanup_old_notifications() had EXECUTE granted to anon, authenticated,
-- public with no internal check -- anyone could trigger it repeatedly,
-- deleting read notifications older than 5 days across every company.
-- Meant to run only via a scheduled job.

REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM anon, authenticated, public;

-- ROLLBACK:
-- GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO anon, authenticated, public;

-- Affected flows: none found in either repo's client/edge-function code, AND
-- confirmed no pg_cron job calls it either (checked cron.job directly -- the
-- only scheduled jobs are build-project-exports and send-project-exports,
-- both unrelated, both running as postgres). This function currently appears
-- to have no caller of any kind, scheduled or otherwise -- the revoke is
-- effectively risk-free.
-- Test: none needed beyond confirming no error appears in Postgres logs after
-- applying, since nothing is known to call this function at all.
