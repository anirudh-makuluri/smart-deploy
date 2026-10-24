# Private app handoff storage

This increment supplies server/database primitives. It exposes no HTTP endpoint,
sets no cookie, changes no runtime routing, and does not make existing app URLs
private. Apply `20261023_app_gateway_auth.sql` only after the workspace,
invitation, and app-use migrations, through the normal reviewed migration process.
No production migration is part of this PR.

## Contract for subsequent gateway adapters

`GatewayAuthStore.issue(bindingId, {userId, sessionId}, challenge)` requires a
live principal resolved by Better Auth on the control plane, including the existing
platform approval gate. Never take that identity from a request body/header.
Issuance must use the control plane's same-origin anti-CSRF checks; an incoming
login/navigation GET must not itself approve a handoff or accept arbitrary state.
It checks current verified app-use permission and creates a random 256-bit code.
The database stores its SHA-256 hash and the S256 challenge, not the raw code or
verifier. The callback is always the registered origin plus
`/__smartdeploy/callback`; callers cannot supply a redirect path or return URL.

`redeem(bindingId, exactCallbackUrl, code, verifier)` requires an independently
authenticated trusted gateway principal restricted to that binding. A binding
UUID, Host header, or code is **not** service authentication. The adapter must
not expose these store methods through unauthenticated routes. Redemption
checks the exact callback, S256 proof, expiry, binding/app, and current identity
and permission. It atomically consumes the code and returns a new random opaque
session token. Concurrent redemption succeeds at most once. Failed redemption
does not consume a valid code. Tokens are returned once and must never be logged.

The future gateway must create a per-browser login transaction, keep its verifier
in trusted gateway state bound to the initiating browser, verify callback state,
and reserve the callback path so customer code never sees it. It must prevent
login CSRF and account/transaction swapping. These browser and authenticated
service adapters remain unimplemented; store tests do not establish that boundary.

The S256 transform and 32-byte random verifier follow
[RFC 7636](https://www.rfc-editor.org/rfc/rfc7636). Exact redirect matching and
transaction binding follow [OAuth security guidance](https://www.rfc-editor.org/rfc/rfc9700).
This is an internal handoff primitive, not a complete OAuth/OIDC provider.

`authorize(bindingId, token)` is for an already authenticated gateway. One fresh
database snapshot checks session expiry, active binding, verified identity,
current workspace ownership/role, and explicit app-use grant. It returns ID/email
or null, with no application business role. Database failures propagate; adapters
must deny on errors. Run this before each HTTP request. It does not terminate
WebSockets: the runtime still needs a bounded revalidation/closure loop and tests.
An already authorized in-flight request cannot be recalled by a later revocation.

`revoke` removes only a session for that binding; repeated logout is harmless.
`pruneExpired` deletes expired codes/sessions without affecting active records.
The eventual control-plane operator job must run cleanup; none is scheduled here.
Expired credentials already fail authorization even before cleanup.

## Configuration and invalidation

There are no production lifetime defaults: constructing the store requires
integer code/session lifetimes. Hard upper bounds are 120 seconds and one hour,
also enforced by SQL constraints. The deployment configuration/product choice
within those bounds remains a prerequisite to enabling the gateway. Sessions
have absolute expiry, no sliding extension or refresh token in this increment.

Bindings are operator-owned records with an app ID and exact canonical HTTPS
origin. No public API creates or edits them. The service role can read/lock and
disable/re-enable a binding, but cannot register origins or change app IDs.
Future provisioning must verify ownership and isolate the application domain
from the control-plane cookie domain before registering any production origin.
This table is an authorization binding, not an upstream routing allowlist or
proof that an origin cannot be bypassed.

Database triggers permanently delete both handoff codes and sessions when a
grant is revoked, membership is removed, a member role changes, workspace owner
or app workspace changes, identity email/verification changes, or a binding is
disabled/re-enabled or its origin is replaced. Regrant, reinvitation, restored
verification, or re-enabling a binding cannot revive old credentials. Grant
revocation affects that app/user; membership changes affect that user's workspace
apps; identity changes affect all of that user's credentials. Owner changes
invalidate the workspace's credentials.
Issuance/redemption share the workspace lock used by membership/grant changes,
lock the identity and binding, and recheck expiry at consumption.

RLS denies client reads; no client write privileges are added. The service role
has select/insert/delete on credentials, no update permission. Invalidation
triggers run with caller privileges and use a fixed search path; they do not
introduce a security-definer bypass. Platform database owners remain trusted.
Better Auth uses the same `getDbPool` as the stores. Before applying, verify the
configured database role can delete credential rows and bypass their RLS when
identity changes invoke the trigger. Owners and the granted `service_role` are
supported here; a custom restricted role needs explicit reviewed grants, or its
identity update will fail and roll back. No provider connection is changed here.
This migration adds triggers to existing tables, so rollback requires removing
those triggers before dropping the new function/tables. Existing public runtime
behavior is unchanged, and reverting must never publish a private runtime.

## Verification boundary

PostgreSQL tests cover hash-only storage, exact callback/app binding, proof,
expiry, concurrent redemption/revocation, permanent invalidation, client RLS,
service-role registration denial, database lifetime limits, and cross-app FKs.
The full unit suite and build remain necessary regression checks.

Local validation on October 23, 2026: 120 unit files / 422 tests and 4 PostgreSQL
16 files / 46 tests passed, including 14 new gateway tests. Lint, production
build, and diff checks passed. The build used local dummy Better Auth values;
the previously recorded Turbopack tracing warning remains. React Doctor 0.9.18
against the exact app-use PR base scanned all three changed TypeScript files and
reported 100/100, zero diagnostics. The broader unchanged dependency-health
baseline is documented in APP_WORKSPACES.md; this does not establish overall
repository health of 95/100. The disposable database was stopped after testing.

The service endpoints and credential boundary are now described in
[APP_GATEWAY_API.md](./APP_GATEWAY_API.md); they remain default-off.
Platform-session binding and global logout are described in
[APP_GATEWAY_LOGOUT.md](./APP_GATEWAY_LOGOUT.md).
Outstanding: browser transaction/cookie handling, cross-app browser proof,
HTTP/WS proxy isolation, private AWS origin/networking,
runtime binding lifecycle, rate limits, and hosted verification. Until those
pass, neither these records nor the app-use API justify a private-app UI label.
