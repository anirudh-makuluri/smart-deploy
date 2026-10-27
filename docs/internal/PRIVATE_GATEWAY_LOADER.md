# Trusted private gateway runtime

Build with `npm run ws:build`; the existing worker image includes
`dist/gateway-server.js`. Its default WebSocket command is unchanged. An operator
can run `node dist/gateway-server.js /absolute/operator-config.json` only after
the private runtime and bounded demo setup are ready. No service, listener or
cloud resource starts merely by importing the loader/router factories.

Startup requires both `WORKSPACE_APPS_ENABLED=true` and
`PRIVATE_APP_GATEWAY_ENABLED=true`, an explicit config file, `DATABASE_URL` and
absolute paths to the gateway TLS key/certificate and platform database CA. The
config is a strict `GatewayServerConfig`: gateway options contain the single app
UUID/environment, AWS account/region/cluster/private domain, HTTPS platform
origin, document enablement, transport deadlines and HTTP limits. Timing contains
refresh/max-staleness milliseconds and an absolute expiry in epoch milliseconds.
The expiry must be in the future and no more than two hours away. Address is
explicitly `127.0.0.1` or `0.0.0.0`; port is explicitly 1024–65535. No credential,
database URL or customer deployment configuration belongs in that JSON file.

Operator files are regular files read with actual byte caps. Key and certificate
must match and be current. Keep their parent directory private and mount them
read-only with ownership permitting only the gateway's runtime user. Database
TLS always verifies the configured CA and peer; URL SSL overrides are removed
before passing the explicit TLS object to pg. Pool size, connection/query/
statement deadlines and idle lifetime are bounded. Do not disable certificate
verification to accommodate a missing CA. Existing Supabase/Better Auth platform
dependencies remain unchanged.

The loader reads the current selected registration for that one app/environment.
It validates identifiers, canonical managed origin, AWS task scope, private IPv4,
exact release certificate and the deterministic credential parameter path before
retrieving a secret. SSM uses the explicit AWS HTTPS endpoint, one attempt and
bounded connection/request/socket limits. The reply must identify that exact
SecureString name/ARN/version and credential UUID. The value is authenticated
against the live database function; it is never returned in metadata or logs.

It then proves the expected TLS 1.3 workload certificate over the private route,
without sending HTTP, and rereads the selected SQL state. Any drift, unpublish,
revocation, mismatch, deadline or cancellation prevents returning a gateway.
SQL and SSM/TLS observation are not one transaction: a selection can change after
the final reread. Every app request still uses live platform authorization and
pinned workload TLS, so the old runtime's revoked service key fails closed.

The router periodically loads a fresh candidate without overlapping refreshes.
An unchanged runtime/generation retains the active gateway's browser login
transactions. A changed selection closes the previous gateway and its in-flight
requests. Reload failure or excess staleness closes the active route and returns
a fixed private 503 until a fresh load succeeds. A different origin is rejected;
changing the binding's host requires restarting the native server with its new
explicit route. Recreated routes may start at generation 1 after unpublish; the
loader's authoritative current selection, rather than a global generation
counter, is the authority. At most two loaded gateway instances are retained.

Expiry and SIGINT/SIGTERM stop serving and close listeners, gateway requests,
reloads, SDK clients and the database pool. Process expiry is a backup guard;
it does not stop EC2, ECS or ALB billing. Durable owned-resource AWS teardown and
budget admission must exist before provisioning or starting the demo. The
launcher/management adapter must still compose the existing AWS task/network
verifier, source preflight/recheck, registration, credential lifecycle and
activation. Loading a selected row does not establish AWS ingress policy or
complete hosted readiness.

Verification layers are separate. Unit tests use fake SQL/SSM with real pinned
TLS for identity, selection, cancellation and lifecycle checks. Two integration
cases use real PostgreSQL current/key/session/grant policy and real TLS with
mocked SSM and document storage; a colleague's unchanged cookie loses access
after grant revocation, and unpublish during credential retrieval prevents load.
The compiled child-process fixture replaces only registry, SSM, platform control
and network routing in a test-only preload that is not in the worker image.
Certificate checks, native HTTPS, serving and expiry are real; that fixture is
not SQL, IAM, DynamoDB, EC2/ECS/ALB, redeployment or hosted acceptance evidence.

Run `npm run test:gateway:process` after the worker build. CI runs it after
`npm run ws:build`; the existing isolated workload process/container checks remain
separate. Full release verification and actual hosted creator/member/outsider
acceptance are still required. No flags, resources, connections, invitations,
migrations or production release are changed by this implementation.

Final serial local verification: 165 unit files / 1,253 tests, 10 PostgreSQL files /
153 tests, 33 real DynamoDB Local cases, two compiled workload process cases, two
compiled gateway process cases, 15 compiled private-app browser cases, five
compiled public/analytics cases and 21 combined cookie/native browser cases pass.
Typecheck, full lint, production and worker/workload builds and diff checks pass.
Complete unfiltered Doctor 0.9.18: 688 files, 100/100, zero errors/warnings/skips.
Disposable fixtures, TLS material, emulator and database are stopped/removed.
The required Linux container and exact-head CI remain separate evidence.
