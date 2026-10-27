# Gateway HTTP isolation policy

The user selected **strip Authorization initially** for the private-app pilot.
This policy prepares browser/request/response boundaries for a trusted gateway.
It is not a listener, customer proxy, authenticated upstream transport or AWS
network rule. Private-gateway flags remain off and existing public URLs remain
public. No database migration or cloud mutation is added.

## Consumer order and authority

1. Select one operator-configured app origin, binding and environment. Unknown
   hosts must not select a default app. Handle reserved login/callback routes
   through `GatewayBrowserAuth` before customer routing.
2. Run `assertBrowserRequest` for ordinary HTTP requests, then obtain fresh
   identity authorization. Missing/denied/unavailable authorization stops the
   request. The header policy itself neither authenticates nor caches identity.
3. Call `requestHeaders` with that current verified identity. Resolve the
   authoritative runtime for the same app/environment/release. Verify its
   unique TLS workload identity before forwarding any header, cookie or body.
   A private address alone is insufficient. The subsequent
   [workload TLS connector](GATEWAY_UPSTREAM_TLS.md) provides peer verification;
   composing it with the streaming proxy remains required.
4. Apply request/body/concurrency limits and stream with backpressure. Do not
   follow customer redirects on the server. Validate all response headers with
   `responseHeaders` before sending any response bytes; a rejected cookie/header
   aborts the response and cancels the upstream body. The subsequent
   [bounded HTTP transport](GATEWAY_HTTP_STREAMING.md) composes this policy and
   workload TLS; authenticated listener/runtime integration remains required.

The constructor copies canonical HTTPS origin, binding UUID and published/
preview classification. Request Host/forwarded/identity headers cannot replace
that context. Errors use fixed generic text and contain no cookie, credential,
identity or backend detail. Never log callback query strings or raw headers.

## Browser and credential contract

Same-origin GET/HEAD resources are allowed. Other origins can open a top-level
GET document link, including the return from platform login, but cannot fetch
private data/assets or frame them. Mutations require the exact app Origin and
same-origin Fetch Metadata when supplied. Unknown metadata, sibling/foreign/null
Origins, upgrades and unsupported methods fail closed. Legacy clients have a
limited HTML-navigation or explicit same-origin Origin fallback; this is not a
claim of support for every older browser. GET/HEAD application handlers must
remain read-only. Cross-origin app APIs and cookie-authenticated non-browser
agents require a separate authenticated protocol, not a relaxed browser check.
[Fetch Metadata semantics](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site).

All paths beginning with the reserved `__smartdeploy` root prefix are excluded
from customer forwarding, including case, encoded and path-parameter variants.
Decoded control characters and ambiguous/excessive encoding fail. Browser
callbacks, normal forwarding and stored post-login return paths share this
classification. Gateway routes remain exact matches; unknown reserved paths
are errors. This also reserves the worker-scope sentinel permanently.

Requests drop Authorization/Proxy-Authorization, reserved platform/gateway and
legacy Better Auth cookies, caller identity/routing headers, Referer, hop fields
and Connection-nominated fields. Only nonreserved well-formed app cookies
survive; ambiguous duplicate customer-cookie names fail. Host/forwarded host
and HTTPS scheme come from configured public origin, never a caller assertion.
The gateway adds `X-SmartDeploy-Binding-Id`, `X-SmartDeploy-Environment` and
`X-SmartDeploy-Identity`. The last is base64url-encoded UTF-8 JSON `{id,email}`;
it assigns no application business role. Apps may trust it only behind verified
exclusive gateway ingress. Custom bearer/Basic authentication and reserved
cookie namespaces are unsupported in this first pilot.

Request headers are bounded to 16 KiB/128 fields, response headers to 32 KiB/128
fields, and individual Set-Cookie values to 4096 bytes. These are parser bounds,
not body, admission, distributed rate or cost controls.

## Customer response boundary

Separate ordinary app cookies remain supported with Secure, host-only scope,
root path when absent and SameSite=Lax when absent. Explicit valid attributes
such as HttpOnly, Strict, expiry and deletion remain; HttpOnly is not forced on
app-owned preferences. Unknown extensions are discarded. Reserved cookie names,
any Domain attribute, combined-cookie ambiguity, duplicate attributes and invalid
cookie shapes reject the whole response with 502. Customer code cannot replace
the gateway cookie or plant parent/sibling-domain cookies.

CORS/timing grants, site-wide Clear-Site-Data, HTTP auth prompts, alternate
routing, reserved identity response headers and public CDN cache directives are
removed. The gateway forces private/no-store, resource policy same-origin,
same-origin framing, nosniff and Vary on cookie/origin/fetch metadata. An
additional CSP frame-ancestors policy intersects with any customer CSP. Referrer
policy is same-origin so ordinary same-origin forms retain Origin proof while
external destinations receive no private path. Reserved auth responses retain
their stronger no-referrer policy. Clear-Site-Data can clear cookies across the
registered domain, so customer apps cannot issue it through this gateway.
[Clear-Site-Data scope](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data),
[connection-specific headers](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Connection).

Service-Worker-Allowed is restricted to `/__smartdeploy/disabled-workers/`, an
otherwise unused permanently reserved namespace. App workers cannot control
the login/callback paths or the ordinary root. Dedicated web workers remain
supported. This does **not** remove a previously installed root service worker:
the pilot must use fresh, never-reused private origins. In-place conversion of
an origin with prior public content/workers is not supported until a separate
migration/cleanup boundary is implemented and verified.

## Verification boundary

Unit tests cover metadata/authority/method/path guards, current-context copying,
credential stripping, Connection nomination, cookie parsing/scope/expiry,
generated header bounds and response policies. The exact parent browser and
transaction modules fail seven new reserved-path/return-path regressions.

Seven Chromium HTTPS cases exercise the actual policy with explicitly seeded
fixture cookies and a fixed fixture identity. They prove same-origin headers,
sibling reads/writes/framing denied even with the app cookie present, permitted
document links, cookie overwrite/parent-scope denial, blocked site-wide clearing,
same-origin forms, root service-worker rejection and isolated/dedicated worker success. This fixture
does not perform identity authorization or contact a customer upstream. The
service-worker case launches a separate browser trusting only the generated
fixture SPKI, with page-wide TLS bypass disabled, and verifies positive scope
registration as well as rejection. No system trust store or production TLS
setting changes. Browser/transaction adapter regressions run alongside it.

Local checks pass 146 unit files / 820 tests (59 new). Seventeen native cases
include the seven policy cases plus ten browser adapter/transaction regressions.
The ten compiled Next/Better Auth/PostgreSQL confirmation cases also pass after
the shared path changes, including creator/member/outsider and logout behavior.
That run builds and typechecks the production source first. Database migrations,
stores and authorization rules are unchanged; #113's complete 107-test database
suite and all CI checks pass, and that unchanged suite was not separately
repeated locally here. CI continues to run it. The disposable database stops
after the compiled browser run. Fixtures close and their generated certificates
are removed. An initial form-navigation race and service-worker certificate
exception were fixed in the fixture; no browser request denial was relaxed.
After replacing a repeated header-array lookup with constant sets, all 116
focused tests and seven policy browser cases pass again. Typecheck, lint and
worker compilation pass. Complete pinned Doctor 0.9.18 scans nine changed
source/test/configuration files at 100/100; the unfiltered 618-file report stays
84/100 with zero errors and the same 37 warning IDs across 26 files. No
suppression, category filtering or threshold change. Full >=95 remains unmet.
The production build also passes after that allocation-only change, using local
dummy auth values with both private feature flags disabled. The compiled native
run separately exercises the enabled path. No production flag was changed.

Still required: verified upstream TLS and streaming HTTP adapter; WebSocket
origin/revalidation/limits; private AWS ingress and direct-origin denial;
fresh-origin allocation; app data/secrets/usage/cost enforcement; publish/share
and invitation UI/tools; full Doctor >=95 and complete hosted acceptance.
