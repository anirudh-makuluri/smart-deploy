# Platform cookies on the shared app domain

The pilot uses the existing platform domain with application siblings. HTTPS
platform cookies now use the `__Host-smartdeploy` prefix, Secure, HttpOnly,
Path=/ and no Domain. A sibling application cannot create a parent-domain
cookie with a valid `__Host-` name, and the platform cookie is not sent to that
sibling. Cookie names alone do not authorize a request; Better Auth still
validates the signed cookie and current session.

The SDK's automatic `__Secure-` name prefix is disabled only because the
explicit prefix already provides the stronger host constraint. Secure remains
explicitly enabled. This policy also covers dynamically created OAuth state
cookies. Cross-subdomain cookies remain disabled. The proxy obtains cookie
definitions from the same SDK configuration and expires them with matching
Secure/HttpOnly/root-path attributes.

Only explicitly configured HTTP loopback development origins use the ordinary
development cookie names. Other HTTP origins and URLs containing credentials,
queries or fragments fail configuration validation. An absent base URL keeps
the secure production policy; local HTTP development must configure its URL.

## Cutover

There is no legacy cookie read fallback. Deploying this change requires users
to sign in again, and OAuth flows started before the cutover must be retried.
It does not rotate the platform secret or change provider connections. Keep
the platform API, proxy and auth configuration on the same release. This
increment does not enable private app hosting, start the worker, merge or
deploy the rollout. The full-feature production and repository Doctor gates
remain in place.

## Regression evidence

Unit tests inspect the installed Better Auth SDK's session and OAuth-state
cookie definitions, local development behavior and unsafe URL rejection. The
proxy regression checks that denial expires host cookies with valid attributes.

`npm run test:e2e:cookies` requires RUN_COOKIE_BROWSER_TESTS=1, matching
DATABASE_URL/TEST_DATABASE_URL pointing to the disposable local
smartdeploy_foundation_test database, a test-only BETTER_AUTH_SECRET, Chromium
and OpenSSL. It resets that local schema before initializing Better Auth. A
temporary self-signed HTTPS server uses control.test and app.control.test via
Chromium's loopback resolver. The generated certificate/key are temporary and
removed after the test. Certificate trust is bypassed only in the fixture.

The actual browser first demonstrates that a valid old signed session cookie
injected by the sibling authenticates under the old policy. Under the new
policy the same cookie cannot authenticate. A genuine platform signup sets a
host cookie; another sibling injection cannot overwrite it, and requests to
the sibling do not carry it. Sign-out removes the host cookie and leaves the
browser unauthenticated despite the remaining legacy cookie. Verification uses
a local SQL fixture; this is SDK/browser/database isolation evidence, not real
OAuth/email verification or a hosted private application traffic test.

The separate private gateway still needs its own host-bound cookies, browser
transaction checks, upstream isolation, revocation and streaming proxy proof.

Local checks pass: 135 unit files / 575 tests, all five browser scenarios above
(including the two existing invitee and two logout cases), full typecheck,
lint, worker compilation and production build. Pinned Doctor 0.9.18 completes
the exact seven-file scan at 100/100 with no findings. The unfiltered 586-file
repository scan remains 82/100 (zero errors / 42 warnings), without suppression.
The required full 95/100 and complete-feature gates remain unmet.
