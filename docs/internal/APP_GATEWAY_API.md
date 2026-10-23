# Gateway control-plane API

This increment adds default-off service endpoints for the handoff/session store.
It does not implement browser login, a traffic proxy, or private AWS origins.
Existing deployed application URLs remain public. No production binding,
credential, provider connection, migration, or resource is created by this PR.

## Authenticated machine boundary

All three endpoints accept POST over HTTPS with `Authorization: Bearer
sd_gateway_<credential-id>.<secret>`. The ID selects an operator-owned database
record; the 32-byte random secret is compared through its SHA-256 hash. The
current unexpired, unrevoked credential determines exactly one active app gateway
binding. Request headers, JSON fields, URL query parameters, and browser cookies
cannot select an app, binding, user, upstream, or target port.

The bearer transport follows the header/TLS guidance in
[RFC 6750](https://www.rfc-editor.org/rfc/rfc6750). This is a private service
credential protocol, not an OAuth/OIDC authorization server. TLS verification
must remain enabled in the gateway client. Protect the full token as a secret.

| Endpoint | Strict JSON body | Success |
|----------|------------------|---------|
| `/api/gateway/authorize` | `{ "token": "<app-session-token>" }` | Current verified identity `{id,email}` for the authenticated binding, after current app-use and platform-approval checks. |
| `/api/gateway/redeem` | `{ "code": "<handoff-code>", "verifier": "<browser-bound-verifier>", "callbackUrl": "<exact-registered-callback>" }` | App session token, absolute expiry, and authorized identity. A session rejected by the final policy/approval check is removed before returning an error. |
| `/api/gateway/logout` | `{ "token": "<app-session-token>" }` | Idempotent removal scoped to the authenticated binding, even if the user has lost app access. |

Bodies with extra fields are rejected. Codes, verifiers, and session tokens must
be exactly 43 base64url characters. The transport accepts uncompressed JSON,
limits actual streamed bytes to 4096 regardless of Content-Length, and enforces
a five-second whole-body read deadline. Oversized/stalled streams are canceled.
These bounds are not a complete ingress or distributed rate-limit policy.

Browser Origin, Cookie, or Sec-Fetch-Site headers, non-HTTPS requests, and any
query parameters are rejected. The gateway must construct a new server request
and must never forward browser headers/cookies/authorization into this channel.
Service authentication is checked before reading the body. Responses use
no-store/no-referrer/nosniff and grant no CORS permission or browser cookie.
Bad service credentials return 401; denied app use returns 403; unavailable
database/approval dependencies fail closed with 503. Errors/logs omit request
credentials, bodies, and database exception details.

Every request freshly checks the service credential/binding. Every authorize
decision freshly checks verified user identity, workspace role/use grant, and,
when WAITING_LIST_ENABLED is true, current platform approval. No positive result
is cached. A decision/request already in flight cannot be recalled by a later
revocation. The future proxy must deny on all non-200 responses, malformed
responses, network errors, and timeouts, and must define bounded WS revalidation.

## Provisioning and rollout prerequisites

Apply `20261023_gateway_service_credentials.sql` after all workspace and
`app_gateway_auth` migrations through a reviewed operator process. It enables
RLS with no client policies. The platform service role can select credentials;
only a trusted database operator can register, revoke, or rotate them. The
`createGatewayServiceCredential` helper returns the one-time token and its hash;
it performs no database write. Never expose it through a browser endpoint.
Operators must choose an explicit expiry, insert only the hash, and deliver the
raw token solely to the separate trusted gateway runtime. No provisioning or
secret-delivery command has been run here.

Rotate by registering a replacement credential for the same binding, securely
updating the gateway, then revoking the old credential. Gateway keys cannot
register origins or issue user handoffs. Do not re-enable compromised keys.
Revoking a service key blocks future machine requests; it does not revoke user
sessions for a legitimate replacement key. Disable the binding for that broader
effect, which invalidates user credentials through the existing triggers.

The feature requires both WORKSPACE_APPS_ENABLED and PRIVATE_APP_GATEWAY_ENABLED.
The latter defaults false. Explicit integer GATEWAY_CODE_TTL_SECONDS (1-120) and
GATEWAY_SESSION_TTL_SECONDS (1-3600) are required; there are no production TTL
defaults. The sample environment keeps the gateway disabled and TTLs empty.

Platform-session binding and global SmartDeploy logout are supplied by
[APP_GATEWAY_LOGOUT.md](./APP_GATEWAY_LOGOUT.md). Apply that migration before
enabling this API; the current handoff store requires a live platform session.

Keep it disabled until the remaining gateway acceptance gates pass: operator
domain/cost decisions, isolated secret delivery, ingress/rate limits, browser
transaction/state/CSRF/cookie handling, complete account-security-flow coverage,
trusted upstream routing, HTTP/WS header and cookie
isolation, direct-origin blocking, and creator/member/outsider browser proof.
There is deliberately no public handoff-issuance endpoint yet.

## Verification boundary

Route tests exercise the guard ordering, authenticated binding selection,
spoofed fields/headers, strict/bounded/timed parsing, approval rechecks, dependency
failures, logout, and redemption cleanup. PostgreSQL tests use the actual
credential lookup, expiry/revocation, disabled bindings, cross-app credential
denial, rerunnable schema, and operator/service/client SQL permissions.
The database suite also invokes the real route handlers against PostgreSQL for
creator/member redemption, authorization, logout, outsider denial, and access/key
revocation. These are Request/Response handler calls, not a browser or network
TLS test.

These are local API/database checks. They do not establish browser login, proxy
behavior, AWS network enforcement, hosted multi-user proof, or private runtime
readiness. No deployment behavior or DeployConfig fields are changed.

Local validation on October 23, 2026: 121 unit files / 437 tests, 5 PostgreSQL 16
files / 53 tests, full lint, production build, and diff checks passed. The exact
storage-PR-base React Doctor scan covered all nine changed TypeScript files and
reported 100/100 with zero diagnostics. The unchanged broader dependency-health
baseline remains documented in APP_WORKSPACES.md. The build used local dummy
Better Auth values and retained the existing Turbopack tracing warning. The
disposable database was stopped afterward.
