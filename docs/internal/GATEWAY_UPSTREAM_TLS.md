# Gateway workload TLS connector

`GatewayUpstreamTls` connects only to a trusted operator-configured RFC1918 IPv4
literal and port. Its certificate identity is one binding UUID, environment and
release UUID: `<binding>.<environment>.<release>.gateway.invalid`. This name is
SNI and certificate identity, not a DNS lookup. Browser input must never create
or update this configuration. The runtime registrar must independently verify
the actual task, VPC, release and binding before constructing/reusing a connector.

The configuration contains exactly one self-signed workload certificate, with
exactly that single DNS SAN. Wildcards, additional SANs, concatenated chains,
private keys, invalid validity windows and oversized configuration are rejected.
The certificate is the only configured trust anchor. The connection requires
TLS 1.3, normal certificate validation, hostname validation, an exact DER leaf
match, and HTTP/1.1 ALPN. A valid chain and hostname alone cannot substitute a
different leaf. Certificates must be unique to a workload release; their private
keys must never be shared across bindings or releases. Provisioning, key delivery,
rotation and retirement are subsequent work. There is no system-CA fallback,
HTTP downgrade, redirect, automatic retry or TLS session reuse cache here.

`connect(signal)` accepts no HTTP headers, cookies or body and resolves only after
the TLS handshake and all peer checks succeed. Configuration validity is checked
at construction, before dialing and again after the handshake. A caller must
await this result before writing anything. Consume it with the HTTP isolation
policy after fresh gateway authorization; this module does not supply identity
or authorize access itself. The dedicated certificate prevents an unrelated
workload at a recycled private address from receiving the eventual HTTP request.

The explicit handshake deadline is 1–5000 ms. Each connector permits 1–32 active
connections, including pending handshakes, and holds capacity until socket close.
Caller cancellation destroys both pending and established sockets. Errors are
generic and do not expose certificates, endpoints or TLS exception details.
The consumer owns the returned socket, error handling, HTTP framing and disposal.
It must add body/header/deadline/idle limits, streaming backpressure and global
admission/usage controls. Creating many connectors would bypass a per-connector
cap; the runtime registry must reuse one bounded instance per authorized runtime
and enforce global limits separately. No listener or customer HTTP/WS proxy is
introduced. Existing application traffic and deployment behavior are unchanged.

## Verification

The unit suite includes real loopback TCP/TLS fixtures. Its injectable dialer
changes only the network address from the configured private IP to loopback;
certificate validation, hostname, pin, ALPN and protocol settings remain intact.
It proves successful HTTP bytes only after verification, wrong workload and
different-leaf denial, a valid alternate chain/hostname needing the pin, TLS
downgrade and missing ALPN denial, expiry, handshake stalls, early close,
cancellation and capacity release. The generated test CA can sign an alternate
leaf expressly to exercise the extra pin check; it is not a shared production CA.
Removing the exact pin makes the alternate-leaf regression fail. Private keys
and certificates are generated locally, deleted by exact paths, and servers and
sockets close after tests. No system trust changes or verification bypass.

The fixture uses an explicit minimal OpenSSL configuration. A first valid-peer
run exposed duplicate extensions inherited from the Windows OpenSSL default;
the fixture configuration was corrected without relaxing TLS verification.
OpenSSL must be available (`OPENSSL_PATH` may explicitly select the executable).
The suite uses the existing Vitest environment because its shared setup requires
browser globals; the TLS connections themselves use native Node networking.

Local verification passes 147 unit files / 872 tests, including 52 new connector
cases. The exact-pin mutation produces the expected single regression failure;
the restored implementation passes. Typecheck, lint, worker compilation and
production Next build pass. The build uses local dummy auth values and disabled
private feature flags. Pinned Doctor 0.9.18 completely scans both changed code
files at 100/100; the full unfiltered 620-file scan remains 84/100 with zero
errors and the same 37 warning IDs across 26 files. No suppressions or category
filters. Full >=95 remains unmet. SQL, routes and browser behavior are unchanged;
the parent #114 exact-head database/browser and preview CI pass. Those browser
and database suites were not separately repeated locally for this connector.

This is local transport proof, not AWS routing, security-group, direct-origin
denial, certificate provisioning, hosted acceptance or an implemented proxy.
Private-gateway flags stay off. Full repository Doctor >=95, HTTP/WS streaming,
AWS ingress and wake/idle controls, durable data/secrets/quotas, publishing UI and
app-scoped tools remain release gates. Nothing is merged, deployed or started.

Node 20 references: [TLS connect and peer verification](https://nodejs.org/docs/latest-v20.x/api/tls.html#tlsconnectoptions-callback),
[X509 certificate metadata](https://nodejs.org/docs/latest-v20.x/api/crypto.html#class-x509certificate).
