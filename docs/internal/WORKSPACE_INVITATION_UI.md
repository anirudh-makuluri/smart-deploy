# Workspace invitation review

`/apps/invitations#token=<invitation-token>` adds the recipient's missing browser
flow using the existing inspection and acceptance endpoints. Creator-side
workspace/app/invitation/grant management and runtime publish controls remain
separate work; this screen does not claim to implement the whole MVP.

The link helper accepts only a canonical HTTPS origin and the issued token
shape. Tokens are carried in fragments, not query strings. A mount-scoped external
store captures the fragment and immediately removes the fragment and query from
the address, preserving Next's history state. Subscription replay retains the
captured value, including React Strict Mode replay. No local/session storage or
new token cookie is introduced. Refresh requires reopening the original link.

Signed-out recipients use the existing Better Auth GitHub flow with a fixed local
callback path and the same fragment. The installed auth implementation retains
that callback in its existing OAuth state; the provider redirect URI stays the
normal auth callback. Tokens are never rendered into the page. This uses the
existing authentication provider and does not change provider connections.

Inspection requires a verified signed-in identity. It displays the workspace,
invitation role, current email and expiration in explicit UTC before showing
Join. Inspection never accepts. Acceptance is one explicit click, with duplicate
submission protection, an eight-second transport deadline, cancellation and
receipt validation against the reviewed workspace ID. An uncertain result cannot
be retried in the same flow: it may have committed, so membership must be checked
before another attempt. Identity changes retire the old view and pending work.

Existing server policy remains authoritative: matching verified email, live
inviter authority, expiry/revocation and waiting-list restrictions are rechecked.
Joining creates workspace membership only. Ordinary members still need an
explicit app-use grant and published link; they gain no management or preview
access. The invitation page stays outside management WebSocket/session-recovery
providers. Both feature flags must be enabled to show this UI.

The route has no-referrer, no-index, frame denial and nosniff protection. Vercel
analytics drops private app navigation/auth callback URLs and removes URL fragments. PostHog
initialization enables its installed SDK's `disable_capture_url_hashes` setting,
which covers event/replay URL fields; its network-capture callback drops
auth/invitation creation, inspection and acceptance traffic, including response
bodies. These client options are code changes, not remote analytics/provider
configuration changes. No token-bearing network body should be recorded.

Final local verification: 170 unit files/1,296 tests, typecheck/full lint,
production builds with private features enabled and disabled, worker/workload
compilation, two compiled gateway and two workload process cases pass. All 18
compiled Next/Better Auth/PostgreSQL/native HTTPS browser cases pass, including
three new cases for explicit pre-approval joining without management access,
wrong-account metadata denial, and revocation after review. Five public/analytics
browser cases pass. Complete unfiltered React Doctor 0.9.18: 100/100 across 699
files, zero errors/warnings/skips, no suppression. The mobile screen was rendered
in Chromium and visually inspected. The unchanged SQL/storage implementations
also pass exact parent #128 CI; their standalone suites were not repeated locally
in this UI slice.

Initial verification caught the SDK network entry's `name` field (not `url`),
three Doctor diagnostics, and an ambiguous browser alert selector that also
matched Next's hidden route announcer. The callback now uses the actual SDK
contract, the UI uses one cohesive review state and explicit locale/timezone,
and the selector targets the invitation region. Final checks pass after repairs.

Browser authentication/approval/verification are controlled local fixtures;
the SQL, production routing, hydration, HTTPS and API requests are real. Analytics
privacy helpers and provider configuration are unit-checked against installed SDK
types; remote PostHog recording was not exercised. Real OAuth, AWS IAM/ingress,
hosted creator/colleague/outsider acceptance and production rollout remain gates.
No production account, invitation, email, connection, migration, flag, AWS
resource or worker state was changed. Local database and fixture servers stopped.
