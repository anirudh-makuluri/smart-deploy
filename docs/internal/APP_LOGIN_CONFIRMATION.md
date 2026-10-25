# App login confirmation

`/apps/authorize` supplies the platform confirmation screen for the gateway
browser adapter. Both workspace/private-gateway flags stay off. It does not
deploy a gateway, protect existing public URLs, or provision AWS resources.

## Display, intent and current authority

The only public query fields are binding UUID, S256 challenge and opaque state.
Missing, duplicate, extra or malformed fields fail without authentication or
metadata lookup. Anonymous visitors receive the existing GitHub login control
with a validated fixed relative callback. No app/workspace metadata is exposed
until a current platform session has access. The existing OAuth connection is
retained; no provider configuration or email delivery changes.

The server bypasses cached cookie snapshots/refresh and calls the read-only
gateway inspection method. Inspection uses the same binding/workspace/session/
user locks and current verification/app-use policy as issuance, but creates no
code, session, invitation acceptance, membership or grant. Admission checks use
the current database email. Ordinary invited members can inspect only granted
published apps before waiting-list approval; previews remain restricted to
verified, approved workspace owners/admins. Display results are snapshots;
issuance, redemption and later authorization still recheck current policy.

The page shows the current email, app/workspace, published versus unpublished
version and exact destination. It follows the existing landing-panel typography
and color system. Continue remains disabled until hydration completes, preventing
early clicks from being lost. Navigation and rendering issue nothing. Continue
sends a same-origin JSON POST with the displayed identity as a required equality
assertion. It never selects a principal. Changed accounts/emails return 409;
the store repeats the comparison under issuance locks. Missing assertions return
400, with no legacy fallback. Ship this browser/issuer protocol together while
flags stay off.

The client accepts only a strict HTTP-200 JSON receipt with the original state,
the inspected exact HTTPS callback, a 43-character code and an unexpired lifetime
of at most two minutes. Redirected/HTML/malformed/error responses never navigate.
Success uses location.replace to the fixed callback. A five-second native-fetch
deadline, synchronous duplicate-click guard, Cancel and unmount cancellation
prevent superseded requests from redirecting. Unconfirmed requests disable
Continue and ask for a refresh to recheck the account. No backend error details
or credentials are shown. Ambiguous failures may leave an unused short-lived
code; public issuance quotas/rate limits remain a separate gate.

This exact route skips management worker/session-recovery providers. Similar
prefixes and management routes retain existing provider behavior. The page is
dynamic/unindexed, uses no-referrer/no-store and forbids framing through CSP
frame-ancestors and X-Frame-Options. React escapes displayed text; app code is
not embedded or executed on this platform origin.

## Local browser proof and limits

The dedicated opt-in fixture prepares only the guarded local disposable
database before building Next. It runs the compiled production app in a separate
plain Node HTTPS child, outside Playwright's source-map transforms. Actual
Better Auth signs local test sessions; SQL establishes verified fixture users.
An approval service is simulated on loopback. Real workspace/invitation/grant
stores, handoff routes, service-key lookup, S256 redemption, browser cookies and
fresh gateway authorization compose in Chromium. App content is a fixed private
fixture, not a customer upstream or a production gateway listener.

Canonical app bindings retain the production standard-port origin constraint.
Chromium maps their port-443 sockets to an unprivileged loopback listener; no
system DNS or database constraint is changed. Machine TLS trusts only the
generated fixture CA and fixed platform SNI; browser certificate exceptions
do not disable machine peer verification. Fixture accounts/approval do not
prove real GitHub OAuth, email verification/delivery, hosted access, AWS ingress
or direct-origin blocking. Test-only processes close and two generated TLS
files are removed. No cloud or production state is changed.

Ten Chromium cases pass against the compiled Next application: anonymous
display without issuance; owner/published login with real signed cookies and
machine redemption; an unapproved verified invitee on mobile; preview and
outsider metadata denial; changed-account rejection; post-render grant
revocation; intercepted malformed-success denial; owner preview login; and
global platform logout removing both environment sessions. The malformed
receipt case intentionally intercepts that response; the positive flows use
the actual API/database. Desktop/mobile screenshots were visually reviewed and
the mobile layout has no horizontal overflow. Fixture ports and the disposable
database are stopped afterward.

The first native candidates exposed test-module/source-map interop, a strict
standard-port binding constraint and a development reload loop. The final
harness uses dynamic ESM-helper import, a separate plain Node process and
compiled production routing. It preserves the production origin/CSRF checks
and database constraint. A pre-hydration lost-click issue was fixed with a
disabled server snapshot. The exact app-login route now bypasses unrelated
management providers. One alert locator was scoped to distinguish the visible
app error from Next's hidden route announcer; the account-switch API correctly
returned 409. No failing policy check was weakened.

All 145 unit files / 761 tests and eight PostgreSQL files / 107 tests pass.
The real compiled browser run also builds and typechecks the app. Verification
uses a private child-process TEMP/TMP directory and runs heavy checks serially.
Full typecheck/lint and worker compilation pass. Two regressions fail with the
pre-fix hydration guard removed and the exact parent route-classification
helper, then all 24 tests in those suites pass after restoring the candidate.
Pinned Doctor 0.9.18 completes all 22 changed source/test/configuration files at
100/100. The unfiltered 614-file report is 84/100 with the same 37 warning IDs
across 26 files and zero errors; the previous report scored 83. No diagnostic
was suppressed or threshold lowered. The full >=95 gate remains unmet.

Remaining release gates include full-repository Doctor >=95, private HTTP/WS
upstream/header/cookie isolation and direct-origin blocking, DynamoDB/S3 quotas,
secrets, on-demand runtime/usage controls, publishing/share/invitation UI and
complete hosted multi-user acceptance within the approved budget.
