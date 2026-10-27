# Platform logout and private-app credentials

Authenticated SmartDeploy sign-out ends all private-app sessions and pending
handoffs for that user, across apps and originating platform logins. Other
users' credentials are unaffected. Other SmartDeploy logins remain signed in;
they can initiate a fresh app login after global invalidation. This implements
the confirmed logout policy without claiming runtime/WS enforcement is shipped.

## Platform-session binding

Apply `20261023_gateway_platform_sessions.sql` after the gateway storage
migration and existing Better Auth schema. It adds required platform-session
foreign keys to codes and app sessions. Existing unbound credentials are deleted
once because their originating session cannot be inferred safely. Users must
sign in to apps again after that upgrade. Rerunning the migration preserves
already bound credentials.
Keep the gateway disabled during this upgrade and deploy the matching store
before resuming traffic: the older store cannot populate the new required keys.

`GatewayAuthStore.issue` now requires `{userId, sessionId}` from a trusted,
uncached Better Auth session lookup. A user ID alone is insufficient. Never
accept the platform session ID from browser JSON or forward its cookie to an
app. Issuance/redemption lock and recheck the actual unexpired platform session
and its user association. App credential expiry is capped at both the configured
lifetime and that platform session's expiry. Authorization also joins the live
platform session in its current database snapshot.

The session/user fields follow the repository's default Better Auth model;
see [Better Auth session management](https://better-auth.com/docs/concepts/session-management).
Cookie caching is bypassed and refresh disabled for the logout identity lookup.
The future handoff browser adapter must apply the same uncached identity rule.

## Atomic sign-out

With both workspace and private-gateway feature flags enabled, POST
`/api/auth/sign-out` requires the same browser origin, resolves the verified
platform principal, and verifies the required database trigger is active. In one
database transaction it locks the platform session and user, removes all that
user's app codes/sessions, and deletes that platform session. Only after commit
does it invoke Better Auth for signed-cookie clearing. It does not implement
cookie cryptography or trust request-supplied user IDs. Unauthenticated logout
has no principal whose other devices can be revoked.

This order matters: the Better Auth 1.6.23 and 1.7.12 sign-out implementations
catch session-deletion errors and can return success while the database row
remains. The guarded path performs the security operation before that behavior
can produce a misleading success. Revocation failure rolls the transaction back,
returns 503, and never invokes cookie clearing. The user can retry with their
existing valid platform session. Errors are redacted and never include cookies,
handoff/session tokens, or database exceptions.

Existing GET/auth endpoints and all auth behavior when the flags are disabled
delegate to the existing handler. The enabled sign-out route deliberately
requires Origin, including for nonbrowser HTTP callers. Internal callers that
use Better Auth directly must understand the database-trigger behavior below.

## Revocation, expiry, and concurrency

Deleting an active platform session directly (including server-side revocation)
invalidates that user's app credentials globally through a database trigger in
the same transaction. Shortening session expiry or changing its user also
invalidates the old user's app credentials. Merely extending expiry does not
extend an existing app credential's absolute lifetime.

Garbage collection of an already expired platform session only cascades its own
linked credentials. It does not unexpectedly end other active browsers' apps.
Explicit authenticated sign-out still clears all app credentials even if the
platform session reaches expiry during the operation.

Issuance/redemption and logout use consistent platform-session → user lock order
after the existing workspace/binding locks. Thus a handoff authenticated before
logout cannot be created from a deleted platform session afterward, and a
concurrent redemption either completes before invalidation or is denied. An
in-flight authorization decision cannot be recalled after it has been returned.
The future proxy must reauthorize HTTP requests and close revoked WebSockets
within its explicitly tested bound; this increment does not supply that loop.

## Compatibility and deployment boundary

This code supports the current database-backed Better Auth configuration with
default `public.session`/`userId`/`expiresAt` fields, no secondary session store,
and no custom session-delete database hooks. The route intentionally performs
the transactional deletion itself; do not add secondary caches, custom auth
models, or delete hooks without adapting and testing this contract. This is not
an authentication provider migration or a change to provider connections.

The platform database role must already be able to read/lock/delete its auth
session rows, lock users, and delete app credentials. The migration adds no
grants on Better Auth tables. Trigger failures roll back auth deletion; review
role privileges before applying. Keep the private gateway disabled until the
remaining browser, proxy, rate-limit, origin, and AWS isolation gates pass.

Rollback must remove the session-change/logout triggers before their function,
and remove the new credential FKs/columns only after disabling private traffic.
Deleted unbound credentials are intentionally not recoverable. No production
migration, connection change, deployment, or cloud resource is performed here.

## Evidence boundary

Tests cover cross-app/cross-login invalidation, other-user isolation, source
session association/expiry, expiry caps, stale principals, concurrent issuance
and redemption versus logout, migration upgrade/rerun, and browser-origin guards.
The integration suite generates the installed Better Auth schema only in the
guarded disposable local database and exercises real sign-up/sign-in, signed
cookies, sign-out, transaction rollback, and expired-session cleanup.

These are API/database integration tests, not browser UI, proxy, hosted, or AWS
origin-blocking proof. Existing application URLs remain public.

Local checks on October 23, 2026: 122 unit files / 443 tests, 6 PostgreSQL 16
files / 63 tests, lint, production build, and diff checks passed. The database
suite was rerun after clarifying the ordered session/identity authorization
helper. The final exact-API-base React Doctor scan covered all eight changed
TypeScript files at 100/100 with zero diagnostics and no suppressions. The
documented broader dependency-health baseline remains unresolved. Build used
local dummy Better Auth values and retained the existing Turbopack tracing
warning. The disposable database was stopped after verification.
