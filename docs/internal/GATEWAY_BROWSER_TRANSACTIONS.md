# Gateway browser transactions

`BrowserTransactions` supplies single-process server state for the gateway's
browser handoff adapter. Starting a transaction generates independent random
256-bit state, browser nonce and PKCE verifier. Only the S256 challenge and state
belong in the platform authorization request. The verifier stays in private
server memory until a matching browser claims the transaction.

The adapter must set the returned cookie as a `Set-Cookie` header, never place it
or a claimed verifier in JSON, URLs, analytics or logs. The fixed login cookie
uses a `__Host-` name, Secure, HttpOnly, root path, no Domain and SameSite=Lax.
The caller must serve HTTPS. The callback must be a reserved gateway route that
never executes customer code. Matching state alone is insufficient: claiming
also requires the browser nonce cookie and the exact operator-selected binding.
The store keeps hashes of state/nonce and compares nonce hashes with
`timingSafeEqual`.

The [OAuth security guidance](https://www.rfc-editor.org/rfc/rfc9700.html)
requires transaction-specific proof/state binding to the initiating user agent.
The [cookie prefix requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
constrain a `__Host-` cookie to its secure host/root path. Those mechanisms
complement the explicit server-side binding; they are not authentication by
themselves.

## Consumer contract

- Construct with explicit integer limits: TTL 1-600 seconds and 1-10000 pending
  entries. These are hard ceilings, not production capacity/lifetime defaults.
- Call `start` only after selecting a configured gateway binding. Never trust a
  request-supplied Host, binding ID or forwarded header as routing authority.
- Set its cookie header and navigate to the fixed platform confirmation route
  with only state, challenge and binding ID. Starting does not approve app use
  or issue a control-plane code.
- On the fixed callback route, validate exact method/path, one code and state,
  bounds and transport before calling `claim`. Supply the actual Cookie header
  and configured binding. Invalid, duplicated, missing or excessive cookies fail.
- Claim synchronously consumes the entry before asynchronous redemption. Wrong
  browser/state/binding requests do not consume a valid flow. Failure or timeout
  after claiming requires a fresh start; never restore a consumed transaction.
- Redeem through the authenticated control-plane API using the claimed verifier.
  Validate its response before setting a separate protected app-session cookie.
  This module implements neither redemption transport nor that app-session cookie.
- Redirect only to the stored normalized local path. External/network paths,
  backslashes, raw controls/spaces, fragments, oversized/invalid encodings and
  the reserved gateway path are rejected. Do not add arbitrary return-URL input
  to the later callback.
- Do not clear a newer login cookie on a stale/failed callback. The transaction
  cookie is inert after consumption and can expire naturally; clearing it after
  an asynchronous result can race a later start in another tab.

Every start rotates the host's nonce. Consequently only the latest unclaimed
login attempt on that host can finish in a normal browser cookie jar; an earlier
tab must restart. Different browser contexts and app hosts stay independent.
This intentional first-adapter limitation is verified, not parallel-tab support.

Expired entries are pruned on start/claim; capacity failures preserve existing
flows. This bounds retained state, not request rate or CPU use. The HTTP adapter
still needs admission/rate limits and controlled unavailable responses. A
restart loses pending transactions safely. Multi-process/replica deployment
requires shared transaction state or guaranteed affinity and separate review;
this map must not be presented as a distributed session store.

## Verification boundaries

Thirty-six unit cases cover nonce/state/binding swaps, S256 derivation, single
claim under concurrency, exact expiry, capacity/recovery, independent instances,
configuration mutation, malformed/duplicate cookies and return paths.

Six native Chromium tests run against a loopback HTTPS fixture using the actual
class. They verify HttpOnly/host-only attributes, simultaneous callbacks,
browser-context swapping, JavaScript pre-seeding, sibling-domain injection,
cross-host non-forwarding, overlapping tabs, capacity and expired state with a
retained cookie. The fixture exposes only state/challenge and a claim boolean;
it never returns the verifier or cookie in JSON. The callback fixture proves
transaction claiming, not authorization-code redemption or app access.
The existing cookie-test configuration includes these cases, with explicit
`RUN_GATEWAY_BROWSER_TESTS=1`; CI opts in alongside platform cookie tests.

No real identity provider, platform database, control-plane issuer, consent UI,
customer proxy or AWS resource participates in this native fixture. Servers
close and the two generated TLS files are removed after checks. Production
flags, provider connections, invitations and cloud state are unchanged. The
full-repository >=95 and integrated private-app production gates remain unmet.

Local verification passes 138 unit files / 659 tests, all six native HTTPS
cases, typecheck, lint, worker compilation, configured production build and diff
checks. Existing dynamic build tracing warnings remain. Database/policy code is
unchanged from #110, whose 100 PostgreSQL tests and all CI/preview checks pass.
Those database tests were not repeated locally for this transaction-only slice;
CI retains the complete existing database/browser job alongside the new cases.

Pinned Doctor 0.9.18 completes four changed source/test/configuration files at
100/100. The complete unfiltered 594-file scan remains 83/100 with zero errors /
37 warnings across 26 files. No suppression, category filter or lowered threshold.
