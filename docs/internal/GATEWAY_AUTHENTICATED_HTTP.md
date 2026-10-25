# Authenticated HTTP composition for one registered runtime

`GatewayAuthenticatedHttp` combines browser sign-in, current control-plane
authorization, HTTP isolation and verified TLS forwarding. Its public `handle`
accepts only a Request; there is no caller-supplied identity override. Browser
and forwarding origin/binding must match, the upstream binding/environment must
match, and platform/app hostnames must differ. Operator configuration selects one
runtime release; the authoritative runtime registrar/listener must still select
and retire instances on routing or release changes. This is not that registrar,
a process entry point, deployed listener or AWS network rule.

Handle reserved routes through `GatewayBrowserAuth` before customer routing.
Reject ordinary browser origin/path/profile failures before authorization. On
every ordinary request with an app session, call the control API for fresh
identity and current membership/grant/environment/session checks before opening
the upstream connection. Missing sessions initiate fixed platform confirmation
only for document navigation; fetch/data requests get private 401 JSON. Explicit
authorization denial and unavailability return their private failure status;
they do not retry, cache identity or contact the app. Reserved callback and login
retain their nonce/state/PKCE and exact-origin constraints.

Bound pending authorization/response-header work to the configured connection
cap in addition to the transport's active response cap. Control RPCs have their
existing whole-call deadline (at most five seconds). On cancellation or registry
retirement, an already-running RPC may finish within that deadline; its result
is discarded before app forwarding, and the pending slot remains held until the
call returns. A callback completed during retirement can leave an undistributed
short-lived app-session row to expire; its cookie is not returned. New work is
denied after `close()`, and active HTTP transports are aborted. Authorization is
checked at request admission, not repeatedly during a bounded HTTP response;
bytes already delivered cannot be revoked. WebSocket periodic revalidation is
separate unfinished work.

Errors use generic private/no-store JSON with anti-framing and content-type
protections. No control-plane exception bodies or app metadata are exposed.
Canceled/denied input is disposed. A native listener bridge must preserve
cancellation without destroying the inbound socket before writing an early
error response, stream successful output with backpressure, and terminate late
stream failures. It must enforce strict host selection, parser/connection limits,
and authoritative runtime mapping. Global admission/rate/usage/cost limits are
still required beyond one instance's caps.

## Integrated proof

The compiled production Next HTTPS suite now uses this actual gateway and real
TLS upstreams, one exclusive certificate per binding/environment/release. Real
Better Auth signed cookies, PostgreSQL stores, confirmation UI, handoff,
redemption and fresh gateway API authorization are composed before actual HTTP
app delivery. Existing creator/member/outsider, account switch, unpublished
preview, pre-confirmation grant revocation and global sign-out cases remain.
Two additional cases verify that browser Authorization, platform/gateway cookies
and spoofed identity/context do not reach the actual app, and that revoking a
previously admitted member's grant denies its next request with zero new app
requests. All 12 browser cases pass locally, with build/typecheck included.

This remains a guarded loopback fixture: accounts are marked verified in SQL,
approval is simulated, app content is fixed, and task networking is mapped to
loopback while preserving TLS peer checks. The fixture's front HTTP bridge
buffers only its small bounded responses; it does not prove a production native
listener's streaming/backpressure or upload behavior. The preceding 50 transport
cases separately exercise native upstream streaming/cancellation. No OAuth or
email delivery, AWS routing/direct-origin denial, customer image or hosted
acceptance is claimed. Generated keys/certificates and servers are cleaned,
and the disposable PostgreSQL server stops afterward.

Twelve new unit cases exercise login/data behavior, fresh authorization, denied
authority/profile/status, pending admission, retirement and configuration
consistency. The dialer deliberately refuses customer traffic in these unit
tests; successful real forwarding is covered by the compiled browser suite.
Temporarily replacing fresh authorization with a fabricated identity produces
the expected denial regression failure, then the implementation is restored.

Local validation passes 149 unit files / 934 tests, including the 12 new unit
cases; typecheck, lint, worker compilation and diff checks pass. The compiled
HTTPS browser run builds production Next source first and passes all 12 cases.
It retains the existing broad-filesystem tracing warning in
`serviceDetectionClassification.ts`; that source is unchanged. The later
authorization mutation is restored byte-for-byte before the full unit and
worker checks. Pinned Doctor 0.9.18 completely scans four changed code/test files
at 100/100; the unfiltered 627-file scan remains 84/100, zero errors and the same
37 warning IDs across 26 files. No suppression or category filtering. Full >=95
remains unmet. Unchanged full database/browser suites pass in exact parent #116
CI; the new compiled PostgreSQL/browser composition is repeated locally here.

Still required: native listener bridge and authoritative runtime registration;
WebSocket limits/revalidation; unique certificate provisioning and private AWS
ingress/direct-origin prevention; on-demand wake/idle/budget controls; app data,
secrets and quotas; publishing/sharing/invitation UI and app tools; full Doctor
>=95 and complete hosted acceptance. Private feature flags stay off outside
local fixtures. Nothing merged, deployed, provisioned or started in AWS.
