# App and workspace foundation

This increment adds data structures and server-side authorization helpers. It
does not add sharing UI, enable team deployment access, or protect hosted apps.
Existing deployments retain their current behavior. Only AWS application
deployment paths are in scope; Better Auth and Supabase remain unchanged.

## Model and authorization boundary

- `app_workspaces` owns apps. Ownership is authoritative in `owner_id`;
  membership rows represent administrators and ordinary members.
- `app_workspace_members` gives membership within exactly one workspace. An
  administrator can manage apps; ordinary membership does not grant deploy or
  secret-management rights. App-use grants come in a later increment.
- `apps` has a stable ID independent of deployments and records its creator for
  provenance. Creation alone grants no enduring management authority.
- Nullable `(app_id, workspace_id)` pairs associate deployments and historical
  deployment runs with apps. Composite foreign keys reject mixed-workspace
  associations. Existing `DeployConfig`, analysis, and release artifacts remain
  the source of truth for build/runtime configuration and deploy history.

Use `src/lib/apps/permissions.ts` with the authenticated Better Auth/CLI user and
fresh, trusted server-side records before privileged queries. Request-supplied
membership roles are never authoritative. The helpers are not wired into legacy
endpoints yet; do not expose team access until those endpoints enforce policy.

The new tables have RLS enabled and no client policies. Only privileged server
access is intended. This does not give service-role queries tenant isolation
automatically: their server handlers must authorize the requested workspace/app.
The metadata does not represent an enforcement layer for deployed app traffic.

## Operator migration and backfill

No migration runs on application startup. Review these scripts before applying
them to an authorized database; scheduled implementation does not apply them.

1. Existing Better Auth tables and `supabase/schema.sql` must already exist.
2. Apply `supabase/migrations/20261023_app_workspaces.sql`. This adds tables,
   nullable association columns, constraints, and indexes in a transaction. It
   is rerunnable and does not associate existing deployments automatically.
3. Optionally run `supabase/migrations/20261023_backfill_personal_apps.sql`. It
   creates one personal workspace per existing deployment owner and one app per
   deployment, then associates uniquely matching historical owner/repo/service
   runs. Ambiguous or orphaned runs remain unassociated; existing associations
   and release artifacts are untouched.

The backfill is transactional, serialized against concurrent backfill runs, and
rerunnable for deployments created later. Do not enable concurrent team writes
while backfilling legacy data. Review counts, ambiguous runs, and ownership before
enabling any future team-access feature. Large installations should schedule a
maintenance window: adding constraints/indexes and backfilling can lock tables.

Rollback boundary: the existing application can run with the additive schema and
associations present. Prefer an application rollback leaving data intact. After
workspace/app data is used, dropping these tables or clearing associations loses
ownership/history metadata and needs a separately reviewed data migration. No
destructive down migration is supplied. App deletion is restricted while a
deployment or historical run references it. Deleting a legacy deployment clears
the app's legacy pointer but keeps its app identity and associated run history.
Deleting workspace owners/creators also requires deliberate data reassignment.

## Verification

Unit policy tests: `npm test -- appWorkspacePermissions --maxWorkers=2`.

Database tests: start a disposable PostgreSQL 16 database named exactly
`smartdeploy_foundation_test` on localhost, set `TEST_DATABASE_URL` to that
database, and run `npm run test:database`. The tests reject any other database
name or remote host. They reset its public schema and install the real base
schema and migrations with minimal Better Auth/Supabase identity prerequisites.
Never point this variable at a database with data you need.

CI runs database tests against a dedicated PostgreSQL service. Coverage includes
rerun/resume behavior, legacy compatibility, ambiguous-history handling,
cross-workspace and partial associations, role constraints, default-deny RLS,
and preservation of release history. Local/CI checks do not prove hosted access
control; the private gateway and live multi-user pilot are later increments.
