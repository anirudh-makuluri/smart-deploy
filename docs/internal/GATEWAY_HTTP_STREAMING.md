# Bounded HTTP transport for one private runtime

`GatewayHttpProxy` composes the HTTP isolation policy and workload TLS connector
for one trusted operator-selected app origin, binding, environment and release.
Context and upstream binding/environment must match. It is a forwarding
component, not a public listener, runtime registry or authentication provider.
Before each `forward(request, currentIdentity)`, the consumer must handle
reserved browser routes, freshly authorize the session with `GatewayBrowserAuth`,
and resolve the current authoritative runtime for that same binding/environment.
Never take the identity, certificate or target from browser input. The browser
adapter must enforce distinct platform/app origins. Missing/denied/unavailable
authorization must stop before this component is called. Call `close()` on route
retirement or release replacement; old instances reject new work and abort their
active exchanges. No route, flag, process or infrastructure is enabled here.

## Request and response boundaries

Browser origin/host/profile, reserved paths, identity schema, header bounds and
known body length are checked before opening TLS. Upload framing ambiguities and
impossible declared bodies fail early. No HTTP headers or body are written until
the exact workload TLS identity is verified. The native Node HTTP parser then
uses that verified socket directly, without DNS lookup, another connection,
automatic redirects, HTTP downgrade, retries or a reusable connection pool.
The upstream Host and trusted identity/environment fields come from the isolation
policy. Authorization, gateway cookies and caller forwarding/identity/hop fields
are removed. Uploads receive new chunked framing; caller framing is not reused.

Upload chunks are read sequentially and each write callback completes before
reading another chunk. Declared and actual length are checked. Responses use a
pull-driven readable stream, retaining native encoded bytes and Content-Encoding;
the proxy does not decompress or parse customer content. It validates raw response
header count, a 32 KiB parser limit, declared body size, status and isolation/cookie
policy before returning any response/body bytes. Informational responses are not
forwarded. Customer upgrades are rejected, not tunneled. HEAD/204/205/304 have no
returned body. Customer redirects are returned to the browser without following
their targets on the server. Request and response trailers are not forwarded.

Each instance requires explicit limits: upload 1–1,048,576 bytes, response
1–10,485,760 encoded bytes, total transport lifetime 1–30,000 ms, idle time
1–5,000 ms, concurrent exchanges 1–32. These are allowed configuration ranges,
not selected production defaults or a guaranteed AWS budget. Limits cover TLS,
upload, response headers and body consumption. The total deadline still expires
when chunks arrive continuously. Unread responses expire; caller cancellation,
consumer cancellation, malformed/truncated responses, runtime retirement and
early app completion dispose upstream sockets and unfinished input. Capacity is
held until response completion or abort; the underlying TLS connector separately
holds its own slot until actual socket close. A new attempt in that short closing
interval may receive 503. Returned responses use a private cache policy; thrown
errors are redacted. The listener must apply private/no-store headers to its own
error responses.

Streaming cannot undo bytes already accepted by an app or browser. An oversized
known Content-Length fails before forwarding; an unknown or dishonest body can
deliver a bounded prefix before the next chunk is rejected. An error after
response headers requires the listener to terminate its outgoing stream, not
replace it with a second HTTP response. Input cancellation and response backpressure
must survive the eventual native listener bridge. Encoded-byte limits do not
limit browser decompression work. Runtime-registry reuse, global admission/rate
and usage/cost controls remain necessary; many instances would multiply these
per-instance caps. This is not an app-data quota or complete $10 cost enforcement.

## Verification scope

Tests use real native HTTPS servers and the real workload TLS connector. The
test dialer maps only the configured private-IP route to loopback and preserves
all TLS checks. Fixed fixture identity is supplied to this forwarding component;
these tests do not simulate or prove authentication. They cover cookie/header
isolation, wrong-TLS-workload zero HTTP requests, origin/path/identity/preflight
denials before dialing, uploads/length failures, response validation before body,
streamed prefixes and caps, HTTP statuses, redirects without follow, compressed
bytes, truncation, upgrade denial, deadlines, idle/unread/cancel/early-response
cleanup, concurrency and runtime retirement. Generated certificates and keys are
deleted by exact paths, and fixture servers/sockets close. A targeted mutation
removing the response policy makes the gateway-cookie overwrite regression fail.

Local checks pass 148 unit files / 922 tests, including 50 new HTTP cases;
typecheck, lint, worker compilation, production build and diff checks pass. After
correcting only the fixture's socket type to the actual HTTPS event `Duplex`,
all 50 focused cases pass again. The production build uses local dummy auth
and disabled private feature flags. Pinned Doctor 0.9.18 completely scans the four
new code files at 100/100; the full unfiltered 624-file report remains 84/100,
zero errors and the same 37 warning IDs across 26 files. No suppression or
category filtering; full >=95 remains unmet. Unchanged database/browser suites
pass in exact parent #115 CI, including Node 20 TLS and compiled confirmation
checks; they were not separately repeated locally for this transport component.

Still required: an authenticated listener/runtime registrar and multi-user native
browser proof of their composition; WebSocket origin/revalidation/limits; unique
certificate issuance and private AWS ingress/direct-origin denial; on-demand
wake/idle/budget controls; app data/secrets/usage; publish/share/invitation UI and
tools; repository Doctor >=95 and complete hosted acceptance. Nothing is merged,
deployed, provisioned, enabled or started by this component.

Node 20 reference: [HTTP request and custom socket creation](https://nodejs.org/docs/latest-v20.x/api/http.html#httprequestoptions-callback).
