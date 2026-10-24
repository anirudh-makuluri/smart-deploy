# App and workspace foundation

This increment adds data structures and server-side authorization helpers. It
also provides opt-in workspace membership APIs after the invitation migration.
It does not add sharing UI, enable team deployment access, or protect hosted apps.
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

For membership APIs, apply `supabase/migrations/20261023_workspace_invitations.sql`
after the foundation migration, then explicitly enable
`WORKSPACE_APPS_ENABLED=true`. The default is false and all workspace routes
return 503 while disabled. Enabling this flag does not enable private hosted
application access. Do not change production configuration during implementation.

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

## Membership and invitations API

These endpoints require a browser session and enforce the existing platform
approval gate. Mutations require an Origin matching the request URL's origin;
missing/foreign origins and CLI bearer tokens alone cannot authorize them.
Configure reverse proxies to preserve the public request URL. Responses are
no-store and use a no-referrer policy. Unknown request fields are rejected.

| Endpoint | Behavior |
|----------|----------|
| `GET /api/workspaces` | List only owned/joined workspaces and the caller's role. |
| `POST /api/workspaces` | Create a team workspace with `{name}`; the session user owns it. |
| `GET /api/workspaces/:workspaceId/members` | Owner/admin roster including the owner. |
| `PATCH /api/workspaces/:workspaceId/members` | Owner-only `{userId, role}` update; owner identity cannot be changed this way. |
| `DELETE /api/workspaces/:workspaceId/members` | Remove `{userId}`. Members can leave; only owners can remove other admins; owners cannot be removed. |
| `GET /api/workspaces/:workspaceId/invitations` | Owner/admin list of unexpired pending invitations; no tokens/hashes. |
| `POST /api/workspaces/:workspaceId/invitations` | Owner/admin creates `{email, role}`; only owners can grant admin. Returns the raw token once in the response body. |
| `DELETE /api/workspaces/:workspaceId/invitations/:invitationId` | Revoke a pending invitation in that workspace. Only owners can revoke admin invitations. |
| `POST /api/workspace-invitations/accept` | Accept `{token}` using the session identity and the current database-verified email. |

Tokens are 256-bit random values, expire after 24 hours, and are stored only as
SHA-256 hashes. No invitation email is sent and no raw-token URL is generated.
A future sharing screen should keep the token in a URL fragment until posting
it to the acceptance endpoint; do not put it in query strings or logs.

Email matching trims/lowercases addresses without removing tags or applying
provider-specific aliases. The accepter must have Better Auth `emailVerified`
set in the current database record; cached session email alone is insufficient.
Invitation acceptance does not bypass platform approval or configure verification
delivery. Use an existing verified sign-in identity until verification UX exists.

Acceptance, revocation, role changes, and member removal serialize on the
workspace row. Acceptance rechecks inviter authority and consumes the invitation
transactionally, so concurrent replay succeeds at most once. Reissuing an invite
revokes the previous pending token. Invitations cannot overwrite an existing
member's role: role changes use the owner-only endpoint. Role changes revoke
pending invites issued by that member; removal also revokes pending invitations
for their current email. Administrators cannot replace an owner's pending admin
invitation. Personal workspaces cannot issue invitations.

Workspace membership manages platform organization; it is separate from app-use
grants and does not expose legacy deployment APIs or secrets to colleagues.
Sharing/acceptance UI, private gateway enforcement, and integrated browser proof
remain subsequent increments. Invitation acceptance/removal has
database/API proof here, not hosted multi-user application proof.

The invitation increment's React Doctor 0.9.18 scan against its exact foundation
base (#91) reports 100/100 with zero errors/warnings. A broader comparison against
`origin/main` reports 43/100 from `socket/low-supply-chain-score`; the isolated
unchanged foundation branch reports the same 43/100. No dependency versions or
diagnostic rules were changed here. This broader dependency-health baseline
still needs separate triage before claiming repository-wide health of 95/100.

## Per-app use access

Apply `supabase/migrations/20261023_app_use_grants.sql` after the foundation and
invitation migrations before enabling/upgrading the workspace API feature.
This increment adds app creation/listing, explicit ordinary-member use grants,
and management access-event records. It does not deploy a gateway or protect
existing public application URLs.

| Endpoint | Behavior |
|----------|----------|
| `GET /api/workspaces/:workspaceId/apps` | Owners/admins see all apps; ordinary members see only explicitly granted apps. Outsiders cannot list the workspace. |
| `POST /api/workspaces/:workspaceId/apps` | Owner/admin creates `{name}`. The creator is provenance; workspace ownership remains authoritative. No deployment configuration is copied or changed. |
| `GET /api/apps/:appId/grants` | Owner/admin lists explicit grants. |
| `POST /api/apps/:appId/grants` | Owner/admin grants `{userId}` use access to a currently verified ordinary member of that workspace. |
| `DELETE /api/apps/:appId/grants` | Owner/admin revokes `{userId}` explicit access. Inherited owner/admin authority must be removed through workspace roles instead. |
| `GET /api/apps/:appId/access-events` | Owner/admin reads up to the latest 100 explicit grant/revoke records. |

Owners and administrators inherit app-management/use authority; ordinary
membership grants neither app use nor app management. A use grant never grants
deployment/configuration/secret management. Creating an app does not grant
enduring authority if its creator later loses their workspace role.

`AppStore.getUseIdentity` takes an already authenticated principal ID and reads
current verification, membership, role, and grant state in one database query.
It returns only the authorized user's ID/email, or null. It does not authenticate
cookies, authorize arbitrary headers, proxy requests, or protect existing URLs.
The future gateway must authenticate first and enforce this lookup for every
request/connection; long-lived connection revocation still needs runtime work.

Removing membership cascades explicit use grants, so reinvitation does not
resurrect them. New lookups fail closed after revocation, role loss, or loss of
email verification. All management mutations share the workspace transaction
lock with invitation/removal operations. Database foreign keys reject mixed-app,
mixed-workspace, and nonmember grant associations.

Explicit grant/revoke changes record actor, subject, app, workspace, and time;
repeating an unchanged grant/revoke does not duplicate events. Automatic grant
cleanup on membership removal is not an explicit-revocation event in this table.
Complete membership/security audit coverage remains later work. RLS denies
client access. The service role has only insert/select privileges on events;
privileged database owners can still modify them. Event history restricts
destructive app/user deletion and requires a reviewed retention/deletion policy.

The next server-storage increment is documented in [APP_GATEWAY_AUTH.md](./APP_GATEWAY_AUTH.md).
It adds handoff/session records and permanent credential invalidation. Gateway
authentication, browser integration, and private runtime enforcement remain
separate acceptance gates.
