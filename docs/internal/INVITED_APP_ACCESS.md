# Invited app access before platform approval

The user approved verified invitees opening only their granted private apps
before general SmartDeploy waiting-list approval. Deployment and workspace
management retain their existing approval and role checks. Both private-app
feature flags remain default-off; this increment does not enable a runtime.

## Admission boundary

An unapproved user may accept an ordinary-member invitation through the dedicated
same-origin browser POST. It requires a fresh platform session, bounded JSON,
and the store's existing verified intended-email, expiry, revocation, inviter
authority, single-use, and transaction checks. Administrator invitations require
platform approval and remain unconsumed when denied. Accepting membership grants
no app use by itself: a manager must still grant that specific app.

Browser handoff and gateway redemption/authorization share an admission check.
An unapproved principal qualifies only through an enabled binding, a current
verified email matching an accepted ordinary-member invitation, current ordinary
membership in that team, and an explicit grant for that exact app. Workspace
owners and administrators cannot use inherited management access as a waiting-list
exception. Current session/use checks still run in the gateway store. Approval
lookup and database failures deny access; positive decisions are not cached.
Membership, identity, grant, session, and binding revocation remain effective.

## Platform boundary

When the pilot flags are enabled, the waiting-list redirect retains the login
needed for app handoff and global logout. It still redirects away from `/home`.
Older APIs sometimes checked authentication without checking platform approval,
so the Next proxy now explicitly matches `/api/:path*` and applies an additional
approval gate. Browser requests with cookies use fresh session lookup; CLI
bearers authenticate and resolve their current user/email before approval.
Cookies never identify authority by their names or formatting. Browser mutations
require the configured platform Origin; foreign/sibling Origin or Fetch Metadata
is denied for protected APIs. CLI requests use bearer authentication without
browser cookies. Destination handlers retain their own authentication, ownership,
and role checks; anonymous requests acquire no authority from this gate.

Explicit app handoff/invitation and gateway-service routes keep their narrower
policies. Identity endpoints, health/docs/public metrics, signed GitHub webhooks,
CLI device initiation/polling, and logout retain their existing policies. This
does not exempt a broad `/api/apps/` or `/api/gateway/` namespace. Approved users
still need each destination's permissions. The platform API approval gate follows
the existing waiting-list flag even when private-app flags are disabled: rolling
back the pilot cannot turn a retained app-only login into platform access.
Production flags are unchanged.

## Verification boundaries

Unit tests exercise handoff/gateway admission, invitation-body limits, approval
failures, unchanged management denial, CLI approval, sibling-origin rejection,
and actual installed Next matcher behavior. The installed Next 16.4.3 testing
export is `unstable_doesMiddlewareMatch`, despite its bundled guide showing the
newer function name.

PostgreSQL integration uses actual signed Better Auth sessions and invitation,
handoff, redemption, and authorization routes. It proves an unapproved invitee
can use the granted app, cannot use a second app or management APIs, and loses
access after grant revocation. Separate cases cover unconsumed administrator
invitations and current invitation/email/role/binding requirements.

The browser scenario uses actual Chromium, Next, Better Auth, and a disposable
local PostgreSQL database. Only the approval-service HTTP backend is a local fake
with explicit approved/denied identities. It proves waiting-list navigation retains login,
actual GraphQL/GitHub/worker/CLI-approval requests return 403, and real sign-out
removes the database session. A second scenario exercises actual approved
GraphQL/worker-token requests and denial immediately after approval revocation.
A local SQL fixture marks the invitee identity verified;
this is not real email/OAuth verification, an invitation UI test, or hosted proof.
CI runs this scenario with a fresh server after the existing logout scenarios.
The complete disposable auth/platform schema is prepared before starting Next: initializing
against the minimal unit fixture can otherwise cache a schema mismatch even
after a test hook recreates the correct tables. Browser hooks no longer recreate
the schema while Next is running. The bootstrap rejects nonlocal
hosts, query overrides, any other database name, mismatched URLs, or missing
explicit browser-test mode before resetting a schema. It never runs for ordinary
development or public/proxy browser tests.

Remaining gates include the app-specific sign-in/approval UI, host-only platform
cookies and sibling-app isolation, gateway browser transactions and proxy,
origin-bypass prevention, data resources, usage controls, and integrated hosted
proof. Existing worker authentication/operations also require their separate
runtime/agent authorization review before activation. No production migration,
provider connection, invitation email, billable resource, merge, or deployment
is performed by this increment.

Final local verification: 130 unit files / 530 tests, seven PostgreSQL files /
72 tests, both invitee Chromium scenarios, both existing logout-recovery
Chromium scenarios, full typecheck, lint, worker compilation, production build,
CI workflow YAML parsing, and diff checks pass. Build validation uses an explicit
local-only auth URL/secret; dynamic repository tracing warnings remain. Pinned
Doctor 0.9.18 scans all 18 changed source files at 100/100 with no diagnostics.
The complete unfiltered full scan remains 82/100 (zero errors / 42 warnings).
No suppression or threshold change. All local database/browser servers are stopped.

This increment initially preserved the approval-only platform policy. The user
subsequently required verified platform management too; the follow-up boundary
is documented in [VERIFIED_PLATFORM_ACCESS.md](./VERIFIED_PLATFORM_ACCESS.md).
The original validation snapshot above is retained. The invited-app exception
already requires current verification. The full 95/100 and remaining feature
release gates still apply.
