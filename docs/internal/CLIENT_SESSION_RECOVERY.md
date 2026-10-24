# Client sign-out and worker session recovery

The header and broken-session recovery guard check Better Auth's returned error
before navigating to `/auth`. A resolved SDK promise is not sufficient: the
guarded server sign-out route can return a 503 when app-session revocation could
not be verified. A failed request keeps the current page and cookies intact and
reports a generic retryable error. The header allows another sign-out attempt;
automatic recovery provides an explicit retry action. Repeated clicks do not
start overlapping requests. Cookie deletion belongs to the server, including
HttpOnly cookies; the client no longer tries to delete parent-domain cookies.

Automatic recovery shares its pending request across React Strict Mode replay.
Its notification and navigation are cancelled on unmount. Unrelated session
errors do not trigger sign-out. These are client behavior guarantees; the
transactional global app-session revocation contract remains in
[APP_GATEWAY_LOGOUT.md](./APP_GATEWAY_LOGOUT.md).

The worker connection lifecycle now follows the signed-in user ID rather than
only a signed-in boolean. Switching directly between accounts replaces the
socket, resets displayed worker state, and creates a separate token cache.
The cache lives in that connection's effect, so a late token response cannot
populate another connection's cache. Unmount disconnects the socket, stops
reconnects, and removes the exact Socket.IO and manager handlers it registered.
Other subscribers' handlers are not removed.

The earlier React Doctor cleanup diagnostic was a detector mismatch: existing
code already returned a teardown that removed all listeners and disconnected.
It was not evidence of an unmount socket leak. The concrete issues addressed
here are accepting failed sign-out as success and preserving a connection/cache
across an account change. Explicit handler ownership also makes teardown
reviewable and testable without broad listener removal.

Regression tests cover server and network failures, explicit and repeated retry,
Strict Mode replay, late completion after unmount, account switching, cleared
logs, stopped reconnects, listener ownership, and delayed token responses. These
tests use the SDK boundary and a Socket.IO test double; they do not establish
live gateway revocation or origin-bypass prevention. Neither runtime enablement
nor production deployment is part of this increment.

## Verification and test infrastructure

The local full unit run passed 125 files / 470 tests. The final focused run
passed all 21 logout/socket tests, including the additional delayed-token case
added while the full run was in progress. The seven-file PostgreSQL suite passed
all 69 tests after the fixture module change. Typechecking, lint, and production
build passed; the prior navigation lint warning is gone. Dynamic repository
filesystem tracing warnings remain a separate build-packaging follow-up.

Two Chromium scenarios exercise the real installed Better Auth client, Next.js
route, and PostgreSQL session store. A disposable database trigger rejects
session deletion: both header sign-out and automatic broken-session recovery
stay on `/home` with a live session and a retryable error. After removing the
trigger, retry reaches `/auth` and the actual session row is absent. The broken
session response and unrelated platform overview/cloud-health requests are
stubbed; revocation and sign-out responses are not stubbed. These are local
browser/auth integration tests, not hosted private-application acceptance proof.

Run `npm run test:e2e:database` with `RUN_DATABASE_BROWSER_TESTS=1`, identical
local `TEST_DATABASE_URL`/`DATABASE_URL`, `BETTER_AUTH_URL=http://localhost:3000`,
a local-only `BETTER_AUTH_SECRET`, both app/gateway flags `true`, and waiting
list `false`. The existing database safety check rejects non-loopback hosts or
any database name other than `smartdeploy_foundation_test`. The fixture drops
and recreates that disposable database's public schema. CI runs these scenarios
after its database suite, with one browser worker and no cloud provisioning.

The shared database helper is now explicitly ESM (`helpers.mts`, imported as
`helpers.mjs`) so Playwright can load the installed ESM auth library and the
helper's `import.meta.url` paths. Existing database tests use the same unchanged
helper implementation. Typechecking now includes `.mts` files. The browser
server probes `/api/health` before fixture preparation, avoiding a prematurely
cached auth schema mismatch, and requires a fresh server for these tests.

Pinned React Doctor 0.9.18, unfiltered full scope, reports 81/100, zero errors,
46 warnings (previous dependency candidate: 72/100, one error, 46 warnings).
The exact changed-file scan covers 17 files and reports 100/100 with zero
diagnostics. The repository-wide 95/100 requirement remains unmet. No rule was
suppressed or threshold lowered. The local database and browser server were
stopped after verification.

After rebasing onto the released analytics hotfix (#101), combined verification
passed 126 unit files / 478 tests, all 69 database tests, both real logout browser
scenarios, and the real analytics browser/network scenario. Full typechecking,
worker compilation, lint, production build, and the full dependency audit passed
(zero vulnerabilities). The fresh unfiltered Doctor result remains 81/100 with
zero errors / 46 warnings; the rebased dependency parent reports 73/100 with one
error / 46 warnings. The exact 17-file recovery diff remains 100/100. The browser
configuration combines both fixtures' requirement for a fresh local server.
Both local servers are stopped. The early production exception covers only the
separately released #101; this feature increment remains gated.
