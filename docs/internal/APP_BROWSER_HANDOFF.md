# Platform browser handoff issuer

`POST /api/apps/handoff` supplies the authenticated platform side of private-app
login. It is default-off behind both WORKSPACE_APPS_ENABLED and
PRIVATE_APP_GATEWAY_ENABLED, and requires the migrations through
`20261023_gateway_platform_sessions.sql`. No migration or runtime configuration
is applied by this increment. Existing application URLs remain unchanged.

## Endpoint contract

Send uncompressed JSON from the configured HTTPS BETTER_AUTH_URL origin with the
user's platform cookie. The only accepted fields are:

```json
{
  "bindingId": "<operator-owned binding UUID>",
  "challenge": "<43-character base64url S256 challenge>",
  "state": "<43-character base64url browser transaction state>",
  "expectedIdentity": { "id": "<displayed account ID>", "email": "<displayed account email>" }
}
```

The endpoint checks the exact configured Origin and request origin, rather than
trusting forwarded headers. If Fetch Metadata is present, Sec-Fetch-Site must be
same-origin; same-site sibling requests are rejected. Query parameters, GET,
form bodies, compression, and extra fields are rejected. Request parsing reuses
the service API's actual 4096-byte and five-second streaming limits. There is no
CORS grant. These bounds do not replace an ingress/distributed rate-limit policy.

Identity comes from Better Auth with cookie-cache snapshots and refresh disabled.
The store then checks the actual live platform-session row, current verified
identity, current membership/app-use policy, and active operator binding under
its existing transaction/locking rules. A supplied user ID or platform-session
ID cannot select the principal. The required expectedIdentity is an equality
assertion against the displayed account, not authority to choose a user. A
changed ID/email returns 409 before issuance; the store repeats that comparison
under its user/session locks. Missing assertions return 400. Browser client and
issuer must release together while flags stay off; no legacy fallback.
When enabled, the platform waiting-list approval
gate is freshly checked; lookup errors fail closed. Authentication/approval
checks precede issuance; fresh authentication precedes body consumption.

Success returns `{code, callbackUrl, expiresAt, state}`. The callback URL is always
the registered binding origin plus `/__smartdeploy/callback`. The request cannot
set a redirect destination, return path, upstream, lifetime, user, or verifier.
Responses use no-store/no-referrer/nosniff, set no cookies, and do not redirect.
Only the code hash is stored, tied to its originating platform session; logout,
grant revocation, and identity/binding changes retain the existing invalidation
behavior. Redemption still requires an independently authenticated gateway and
the correct verifier. Database/unexpected errors are redacted and return 503.

## Required browser/gateway integration

This endpoint alone is not a complete browser login protocol. State is echoed
opaque correlation data, not an authenticated credential or a server assertion
that a browser transaction exists. The platform confirmation screen must
call this POST only after explicit user intent; receiving a navigation/link must
not automatically issue a handoff.

Before sending the browser to that screen, the trusted gateway must generate a
fresh random state and verifier and keep the verifier in trusted state bound to
that initiating browser. Its reserved callback must check and consume its
browser transaction, compare state, and use its authenticated server channel to
redeem the code. A missing, mismatched, expired, or replayed browser transaction
must fail before redemption or session-cookie creation. Never let a caller's
state or binding UUID substitute for that check. The callback and its credentials
must never reach customer code or logs. The gateway must also choose safe code
transport/history cleanup, set isolated protected cookies, and prevent cross-app
requests. These remain acceptance gates before enabling this endpoint.

The same-origin/JSON defenses follow the mechanisms described by
[MDN's CSRF guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF).
Exact callback matching, S256 proof, and browser transaction binding follow
[RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). This is an internal handoff
protocol, not a complete OAuth/OIDC provider.

Subsequent integration: [GATEWAY_BROWSER_AUTH.md](./GATEWAY_BROWSER_AUTH.md)
implements the bounded gateway transaction/callback, authenticated redemption
client and isolated app cookie. Native HTTPS tests use a synthetic control
plane; the real confirmation UI and customer runtime remain unfinished. The
machine client and API now require a matching configured-binding header and
must be released together while gateway flags remain off. The current
[confirmation screen](./APP_LOGIN_CONFIRMATION.md) now prepares authorized
display metadata without issuing, and requires an explicit Continue action.
The historical API-only verification below does not describe that later slice.

## Verification and remaining boundary

Unit tests cover feature/configuration gates, guard ordering, origin and metadata
spoofing, strict/bounded inputs, fresh authentication, platform approval failure,
trusted principal/callback selection, and redacted errors. PostgreSQL integration
tests use the installed Better Auth schema and real signed cookies for issuance,
single-use proof-bound redemption, outsider/member denial, explicit grants,
verification loss, expired/forged login, disabled binding, approval denial, and
revocation/logout after issuance.

These are Request/Response handler and database tests. They do not exercise a
rendered confirmation screen, browser transaction/cookies, network TLS, proxy
HTTP/WebSocket behavior, private AWS origins, or hosted access enforcement.
Production lifetimes, app-domain isolation, gateway keys, infrastructure/cost
approval, rate limits, and complete browser/runtime verification remain required.
Keep the gateway disabled until those gates pass; do not label an app private
based on these API checks.

Local validation: 123 unit files / 456 tests (13 new issuer tests), 7 PostgreSQL 16
files / 69 tests (6 new signed-cookie integration cases), full lint, production
build, and diff checks passed. React Doctor against the exact global-logout PR
base scanned all four changed TypeScript files and reported 100/100 with no
diagnostics. This is a changed-code score; the broader dependency-health baseline
recorded in APP_WORKSPACES.md remains unresolved. The build used local dummy
Better Auth values and retained the existing Turbopack tracing warning. The
disposable local database was stopped after testing. No production migration,
cloud provisioning, deployment, invitation email, or connection change occurred.
