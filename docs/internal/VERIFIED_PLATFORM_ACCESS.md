# Verified identity for platform management

The user required verified email for platform deployment and management, in
addition to applicable waiting-list approval. Verification remains mandatory
when waiting-list approval or the private-app pilot flags are disabled.
Existing Better Auth/Supabase providers and the separate invited-app exception
remain in place. This increment does not configure email delivery or change
provider connections; users need a verified identity before management access.

## Browser and CLI boundary

`platformAccess.ts` accepts identities only from fresh Better Auth or database
lookups. It rejects missing/unverified users, enforces the existing approval
switch, and redacts backend failures. Next's protected API gate uses this policy
in every mode, while retaining the narrow identity/public/app-service exclusions
from the preceding increment. Browser Origin/Fetch Metadata checks now also
remain effective when waiting-list checks are disabled. Workspace management
and worker credential issuance independently check the same verified policy.
Browser lookups disable cookie-cache snapshots and session refresh.

Existing CLI credentials resolve their current database user before access.
Device approval and redemption recheck the policy too. Verification loss between
approval and redemption rolls back consumption and returns no token; retry may
succeed after current authority is restored. Credential responses use no-store,
and malformed bodies and backend failures receive controlled errors. No
caller-supplied user, email, verification flag, or session identifier establishes
authority. The server's session/database records remain authoritative.

## Control-plane worker connections

Worker credential v2 includes an explicit audience/version and the live platform
session ID. Its HMAC key is derived for this purpose from the existing secret;
the Better Auth secret is not rotated. Legacy tokens have no fallback. The
five-minute expiry bounds handshake admission; an established connection is
authorized against its live database session rather than treating an old signed
user ID as indefinite authority.

The worker checks current session ownership/expiry, email verification, and
approval before accepting a connection and before every inbound packet. Idle
streams are rechecked every 30 seconds with a five-second authorization deadline.
The configured idle revocation window is 35 seconds; checks fail closed, and
disconnect clears the timer. Concurrent pending checks may share one request,
but successful decisions are not cached. Late completion cannot reauthorize a
disconnected socket. Database query and approval HTTP requests also have bounds.

An explicit Origin allowlist is required for socket admission. Engine.IO
`allowRequest` protects direct WebSocket transport as well as polling; the CORS
callback alone would not enforce that boundary. See the
[Socket.IO CORS documentation](https://socket.io/docs/v4/handling-cors/) and
[connection middleware lifecycle](https://socket.io/docs/v4/middlewares/).
The runtime must have working platform database/auth/approval configuration;
missing configuration denies access. Operator configuration and hosted proof
remain release gates. The API issuer and worker must be released together; the
worker remains stopped during implementation.

## Validation scope and remaining work

Tests cover verified/unverified identities independently of the approval flag,
CLI credential use/redemption, token audience/session binding, session deletion
and expiry, per-packet authorization, idle revocation, deadlines, and teardown.
PostgreSQL/actual loopback WebSocket tests verify a denied packet never reaches
its handler, revoked sessions cannot reconnect, and a sibling Origin cannot
connect over WebSocket. Approval decisions are test doubles in those database
tests. Browser tests exercise actual Next/Better Auth/PostgreSQL with a local
fake approval HTTP backend, including denial before verification and immediately
after verification or approval is removed. Local SQL verification fixtures do
not establish real email/OAuth verification or hosted end-to-end proof.

This is platform management authorization, not the private application traffic
proxy. Host-only cookies, gateway browser transactions, runtime origin isolation,
durable AWS app data, preview/publish/share UI, app-scoped agent tools and resource
controls, and integrated pilot evidence remain separate rollout gates. This
increment performs no production migration, cloud provisioning, invitation
email, provider connection change, worker start, merge, or deployment.

Final local checks pass: 134 unit files / 563 tests, eight PostgreSQL files /
79 tests, both verification/invitee browser scenarios, both logout-recovery
browser scenarios, full typecheck, lint, worker compilation, production build,
and diff checks. Pinned Doctor 0.9.18 completes the 22-file scan at 100/100
without findings; the unfiltered 582-file scan remains 82/100, zero errors /
42 warnings. No suppression or threshold change. The full 95/100 requirement
and complete-feature production gate remain unmet. Build tracing warnings are
unchanged; build configuration uses a local-only auth URL/secret. Local browser,
socket-fixture and PostgreSQL servers are stopped.

A read-only production metadata audit on October 24 found no `anon` or
`authenticated` privileges on the core `user`, `session`, `account`, and
`verification` tables. Both client roles lack login/superuser/RLS-bypass rights.
CLI tables have RLS enabled with no policies; their broader table ACLs were not
changed. Only catalog metadata was read, both transactions were rolled back,
and no production identity, credential, permission or configuration was changed.
This audit does not claim a complete public-RPC or hosted feature assessment.
