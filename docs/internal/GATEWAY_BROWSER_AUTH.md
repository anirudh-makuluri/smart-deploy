# Gateway browser authentication adapter

This slice connects the bounded browser transaction primitive to a strict
machine control client and a separate app-session cookie. It adds no listener,
production route, platform confirmation page, customer proxy or AWS resource.
Both private-gateway feature flags remain off. Existing application URLs have
no additional protection until the remaining runtime gates are implemented.

## HTTP and credential boundaries

`GatewayBrowserAuth` is configured by the operator for one canonical HTTPS app
origin, one binding UUID, a distinct platform hostname, a service credential,
an explicit deadline and bounded transaction limits. Cookie isolation requires
different hostnames; different ports on the same hostname are rejected.

`GET /__smartdeploy/login` accepts only one local `returnPath`. It creates a
fresh host-only browser nonce and redirects to the fixed platform
`/apps/authorize` path with public binding/challenge/state parameters. The
server-private PKCE verifier stays in the transaction store. No requested
upstream, binding override or external return target is accepted.

The callback accepts exactly one code and state. It claims the browser-bound
transaction synchronously before awaiting redemption, then exchanges the code
using the fixed callback and private verifier. Only validated redemption can
set `__Host-smartdeploy-app-session`: Secure, HttpOnly, SameSite=Lax, Path=/,
no Domain, and at most one hour. The redirect uses the stored local path.
Failed redemption sets/clears no cookie and consumes the claimed attempt;
users restart login. A nonce is not cleared asynchronously because that could
erase a newer tab's transaction cookie. Only the most recently started login
on a host can complete with its rotated nonce, as documented in the transaction
primitive. Expiry and restart require a new attempt.

Reserved routes require top-level navigation with acceptable Origin/Fetch
Metadata; unknown/encoded reserved variants fail without reaching customer
routing. Responses prohibit caching, referrers and framing. Unrelated paths
return `null`: **the consumer must still call `identity()` and deny before any
customer forwarding**. Each call performs fresh authorization without caching;
spoofed browser identity headers are ignored. No proxy is supplied by this slice.

The machine client constructs fresh HTTPS POST requests with only its JSON
content type, service bearer and configured `X-SmartDeploy-Binding-Id`. This
required assertion must match the credential's server-selected binding; see
[the API compatibility change](./APP_GATEWAY_API.md). Browser cookies, Origin,
Fetch Metadata and caller authorization are never copied. TLS verification is
required. Redirects, unexpected response URLs/statuses, non-JSON, invalid UTF-8,
unknown/missing fields, oversized bodies, stale/excessive expiry, transport
failure and timeout all deny. Responses are bounded to 4096 streamed bytes and
the explicit 1–5000 ms deadline covers transport and body reading. Error text
does not expose response bodies, credentials or transport exceptions.

## Verification and remaining gates

The unit suite exercises fixed authority, binding assertions, response and
cookie validation, cancellation/deadlines, wrong-browser callbacks, replay,
query overrides, reserved paths and fresh authorization. PostgreSQL route
coverage includes a valid other-tenant key/session denied by the configured
binding assertion, its proper binding accepted, cross-binding tokens denied,
and missing assertions denied. Existing published/preview and invitation
boundaries remain in the complete database suite.

Four native Chromium cases run the actual adapter/client over loopback HTTPS:
S256 exchange and stored destination, wrong-browser denial followed by rightful
completion, malformed-success denial/replay, and later authorization revocation
plus reserved-path isolation. The machine transport trusts only the generated
fixture certificate and uses its platform SNI; browser fixture TLS exceptions
do not disable machine TLS validation. Six existing transaction browser cases
run alongside them. Fixture servers close and their two generated TLS files
are removed. The control plane and identities are synthetic: these checks do
not prove real Better Auth/SQL integration, hosted OAuth or customer traffic.

Pending: platform confirmation UI with fresh identity/policy inspection;
full HTTP/WS header/cookie/stream isolation; private authenticated upstreams
and direct-origin blocking; DynamoDB/S3 data quotas and secrets; publishing UI;
app-scoped tools/usage; ingress limits; integrated multi-user acceptance;
and full-repository React Doctor >=95. The rollout remains a draft dependency
stack. No production migration, resource, startup, merge or deployment occurs.

Local verification: 140 unit files / 705 tests, eight PostgreSQL files / 101
tests, and ten native HTTPS browser cases pass. The new binding assertion test
fails against the exact parent API module (200 instead of expected 403), then
passes with the guard restored. A test-fixture inference error was corrected
with an explicit header-array type; full typecheck, lint, worker compilation
and configured production build pass afterward. The 63 focused unit cases were
repeated after this typing-only correction. The build uses local dummy auth
configuration and retains existing dynamic tracing warnings. The disposable
database is stopped; no production identity/provider participates.

Pinned Doctor 0.9.18 completes all eleven changed source/test/configuration
files at 100/100. The complete unfiltered 600-file scan remains 83/100 with
zero errors and the same 37 warning diagnostics across 26 files. No suppression
or threshold change. Full repository >=95 remains a release blocker.
