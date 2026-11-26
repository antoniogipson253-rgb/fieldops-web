# Migration convention for this project

This project does **not** use Supabase CLI's native migration history
(`supabase_migrations.schema_migrations`). That schema does not exist in the
live database — it never has. Every schema change on this project, including
everything in `supabase/migrations/`, has been applied by hand via
`supabase db query --linked -f <file>`, never `supabase migration up` or
`supabase db push`. This file documents the convention that's grown out of
that, so it stays consistent going forward.

## Filename format

```
YYYYMMDDHHMMSS_short_name.sql
```

The timestamp is the date the file was written, with a sequencing suffix on
the time portion when several files are written the same day — e.g.
`20261123090001`, `...090002`, `...090003` for three files from 2026-11-23,
in application order. The suffix only needs to sort correctly against other
files from the same day; it isn't a real timestamp.

## Applying a migration

- **One file at a time.** Never batch several files into one `db query` call,
  and never use `supabase db push` — it applies every pending file in the
  migrations folder at once, with no way to stop between them.
- Apply via:
  ```
  supabase db query --linked -f supabase/migrations/<file>.sql
  ```
- Before anything that **changes data** (not just permissions, policies, or
  function bodies): take a backup/snapshot first. This project is on a plan
  with no automatic backups and no PITR, and `supabase db dump` needs Docker,
  which generally isn't available — the fallback is a hand-built export via
  read-only `db query` calls (per-table paginated JSON, a schema snapshot via
  `pg_get_functiondef`/`pg_get_constraintdef`/etc., row-count verification
  against live `count(*)`), saved to `C:\Users\anton\fieldops-backups\`.
- After applying, verify the change actually landed — via the catalog
  (`pg_policies`, `pg_proc`/`pg_get_functiondef`, `has_function_privilege`,
  etc.), not just "no error was returned."

## Recording what happened

- **`supabase/manual/applied-log.txt`**: one entry per migration (or
  function-only deploy, or other DB-affecting action), written *after*
  applying, covering: what was applied and how (the exact command), what was
  verified and the result, and — for anything tested — the test scenarios and
  outcomes, plus cleanup/residue-scan results if fixtures were used.
- **`supabase/manual/rollback-2026-11-23.sql`**: the exact SQL to undo each
  migration, one section per migration. For most of these (revokes, policy
  swaps, function body changes) this is a `GRANT`/`DROP POLICY`+`CREATE
  POLICY`/`CREATE OR REPLACE FUNCTION` back to the pre-change definition. For
  anything that deletes rows, the rollback is the exact `INSERT` statements to
  restore them, built from the backup taken beforehand. Despite the filename
  date, this file keeps growing — it is not reset per day.
- Migration files themselves are self-documenting: each one opens with a
  comment block explaining *why*, what it changes, what was checked before
  writing it, and (once applied) the verification/test results — and ends
  with its own `-- ROLLBACK:` comment block, even though the authoritative
  copy also lives in the shared rollback file.

## Branch workflow

- Work happens on a dedicated branch off `main` (named for the task, e.g.
  `security/phase1-fixes`, `housekeeping/db-conventions`), never directly on
  `main`.
- The branch is only merged into `main` after explicit approval, and only via
  a fast-forward merge (`git merge --ff-only`) — never a force push, never a
  merge commit unless history has already diverged (which hasn't happened
  yet on this project; every merge so far has been a clean fast-forward).
- Before switching branches, check whether any untracked local file (e.g.
  `supabase.exe`) would be affected — `git checkout` can silently re-track and
  then delete an untracked file whose content happens to match a tracked
  blob.

## Testing

- Tests run against **fresh, disposable fixtures only** — throwaway users at
  an address like `zz-test-...@example.invalid`, created via the admin API
  with `email_confirm: true` (so no real confirmation email goes out),
  throwaway companies/projects/tasks built the same way the real app would
  build them (so the data shapes match production).
- **Never** against a real company, a real user, or any account other than
  the operator's own authenticated CLI/tool session.
- Every fixture gets fully cleaned up afterward: the DB rows, any storage
  objects a test wrote, and the auth users — with a before/after row-count
  comparison and a residue scan (a query matching the fixture's naming
  pattern, expected to return zero) to prove nothing was left behind.
- One recurring cleanup pitfall worth watching for: `companies.created_by`
  has `ON DELETE SET NULL` (via `profiles`). Deleting `profiles` before
  `companies` in the same script will silently null out `created_by` before
  a later `DELETE ... WHERE created_by IN (...)` can match it, leaving the
  company row behind. Delete `companies` by explicit id, not by a
  `created_by` subquery, when both are being deleted in the same pass.

## Handling drift

If `supabase/migrations/*.sql` and the live database's actual state ever
disagree — a file exists that was never applied, or the database has
something no file describes — resolve it by comparing the **catalog**
(`pg_proc`, `pg_policies`, `has_function_privilege`, etc.) against what each
file claims to do, not by trusting either side blindly. Since there is no
`schema_migrations` table, there is no "repair" command that reconciles
history against files — only manual verification, file by file. See the
drift report in this project's working notes for a concrete example of this
exercise (every local file was checked against live function/policy
definitions, not against a history table that doesn't exist).

A concrete example: `public.handle_new_user()` (the `AFTER INSERT ON
auth.users` trigger function) was never tracked in any migration file before
`20261125090018_trial_30_days.sql` — it existed only live, predating this
project's migration-file convention. That file's `CREATE OR REPLACE` is the
first time its body appears in `supabase/migrations/`. It also has **no
`SET search_path` pin**, confirmed via `pg_get_functiondef` both before
writing that migration and again immediately before applying it — this is a
pre-existing gap, not something introduced by that migration, and it was
deliberately left as-is rather than silently adding a pin while also changing
the trial length. **Follow-up, not yet scheduled:** pin `search_path` on
`handle_new_user()` as its own separate, deliberate change.
