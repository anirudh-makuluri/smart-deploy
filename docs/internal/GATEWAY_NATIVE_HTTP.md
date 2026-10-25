# Native HTTPS gateway protocol bridge

`createGatewayHttpsServer` creates an **unbound** Node HTTPS server for a fixed
operator-configured set of origins and handlers. Callers must supply actual
`GatewayAuthenticatedHttp` instances, trusted certificate/key material and
explicit limits. The factory does not choose a listener address, start a process,
provision a certificate, register a task or create cloud resources. The runtime
registrar/startup integration and AWS private ingress remain subsequent work.

## Protocol and resource boundaries

Each configured origin is canonical HTTPS. Unknown Host values have no default
tenant. Require HTTP/1.1, exactly one Host, origin-form paths, supported methods,
bounded raw header count/bytes, and unambiguous body framing. Reject duplicate
Host/Cookie/framing headers, GET/HEAD bodies, absolute/network-path targets,
backslashes and controls. Ignore forwarding fields as URL authority. The native
parser caps header bytes at 16 KiB; all raw fields are retained within that byte
cap so the 128-field/duplicate checks see the complete input rather than a
truncated header list. Request body bytes have an independent explicit cap.

TLS handshakes, headers, socket inactivity, complete request handling and response
streaming are bounded. HTTP/1.1 connections serve one request and close; global
physical connections and active exchanges have explicit caps. `Expect` is
rejected without automatically sending 100 Continue. CONNECT, upgrades and
pipelined extra requests cannot become tunnels. Parser errors before request
admission receive a private empty 400. Errors during an admitted exchange abort
that exchange rather than appending a second raw response. TLS frontend minimum
is 1.2; the separate app workload connector still requires TLS 1.3 and an exact
workload identity. HTTP/2 is not implemented by this server.

Convert input to a pull-driven Web Request body. Canceling input pauses it and
removes its listeners; it does **not** destroy IncomingMessage before sending an
early denial. This allows complete 401/413 responses even when the client has
not sent its declared body. Connection-close/response completion then disposes
the inbound connection. Input errors, client disconnects and bridge deadlines
abort the Web Request, which cancels app transport. Pending control-plane RPCs
remain bounded by their existing deadline and their late results are discarded.

Output reads one bounded chunk and completes each native write callback before
reading another. Header/count/declared-size checks and the first bounded read
precede committing client headers. Preserve separate Set-Cookie fields, including
the gateway's own protected callback cookies. Force private/no-store and close
connections. The gateway/transport already distinguishes its protected cookies
from customer cookies; the native bridge cannot independently authorize those
headers and must not be attached directly to an untrusted app handler.
Bodyless statuses/HEAD stay bodyless. Late stream errors destroy output instead
of returning a second HTTP status. Error responses are generic, clear any
uncommitted headers/cookies, and finish before normal connection cleanup.

Bridge limits reuse `GatewayHttpLimits`: upload at most 1 MiB, encoded response
at most 10 MiB, lifetime at most 30 seconds, idle at most 5 seconds, concurrency
at most 32. These are configuration ranges, not production defaults or a cost
guarantee. Header timeout is also bounded by request timeout.
Fixed small error responses, headers, framing and TLS overhead are additional to
the application-body caps. No identity,
membership, runtime or usage result is cached here. Multiple servers/registries
would multiply these caps, so controller/global cost and rate enforcement remain
necessary. Registration must use fresh private origins and retire old handlers.

## Verification

Native protocol cases use real HTTPS clients/raw TLS connections and a generated
certificate, preserving peer verification. Their trusted handler is a fixture,
not simulated authorization. They test streamed input/output, full early denial
with unread input, framing/headers/Host/path/method denial, Expect/tunnel handling,
deadline/disconnect cleanup, separate cookies and late stream failure without a
second response. They use a fixture SNI with a configured app Host to inspect
protocol behavior; actual public-origin/certificate/browser composition is
tested separately below. Generated keys/certificates and all servers/sockets
are cleaned. A deliberate change that destroys input on cancellation makes the
early-denial regression fail, then the source is restored.

The compiled production Next/PostgreSQL HTTPS suite now uses this actual native
server instead of buffering gateway fixture output. All 15 cases pass, including
the preceding real sign-in/current-authorization/verified-TLS app cases, plus
same-origin app uploads, readable anonymous POST denial with zero app requests,
and rejection of an actual app's gateway-cookie overwrite while preserving the
valid session. The worker's app URL and TLS route map are still loopback fixture
configuration; verification is set in SQL and approval/app content are fixtures.
This is not hosted OAuth, production certificate provisioning, AWS routing,
direct-origin denial or customer-container proof. PostgreSQL stops afterward.

Local checks pass 150 unit files / 956 tests (22 new protocol cases), 15 compiled
Next/PostgreSQL/browser cases (three new), typecheck, lint, worker compilation,
build and diff checks. The first timeout fixture exposed header timeout exceeding
request timeout; the factory now bounds it by both limits. The cancellation
mutation produces the expected single socket-hang-up regression, with exact
source restored before the full suite. The production build is included in the
compiled browser run and retains the existing unchanged filesystem tracing
warning. Complete pinned Doctor 0.9.18: five changed code/test files 100/100;
unfiltered 631-file scan 84/100, zero errors and the same 37 warning IDs across
26 files. No suppression or category filtering; full >=95 remains unmet.
Unchanged full database/browser suites pass in exact parent #117 CI; this new
compiled PostgreSQL/browser composition is also repeated locally. Fixture
certificates/servers are cleaned and PostgreSQL is stopped.

Still required: authoritative runtime registration/process integration; WebSocket
origin/revalidation/limits; certificate provisioning and private AWS ingress;
on-demand wake/idle/budget enforcement; app data/secrets/quotas; publish/share/
invitation UI/tools; full Doctor >=95 and complete hosted acceptance. No
production flags, migrations, providers, emails, AWS startup or deployment.

The next control-plane metadata slice is described in
[APP_RUNTIME_REGISTRATION.md](APP_RUNTIME_REGISTRATION.md). It validates and
selects registrations but does not attest AWS state or start this server.

Node 20 reference: [HTTP server options, lifecycle and protocol events](https://nodejs.org/docs/latest-v20.x/api/http.html#httpcreateserveroptions-requestlistener).
