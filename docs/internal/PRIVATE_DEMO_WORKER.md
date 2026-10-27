# Runtime-only private-app demo worker

`dist/private-demo-worker.js` is a dedicated entrypoint for the bounded curated
demo. It registers only the prepared `apps:runtime` acknowledgement channel.
Signed worker tokens, the existing origin allowlist, fresh platform-session /
verified-email / approval checks and per-packet/idle revocation remain in force.
The controller still rechecks a verified manager, source, AWS/SSM/TLS evidence
and compare-and-swap selection. Unknown deployment, agent and workspace events
receive a fixed unavailable acknowledgement without invoking the controller.
There is no internal deployment-event HTTP bridge or background deployment
reconciler in this process. The deferred agent flow is not implemented here.

The CLI requires production mode, the existing auth secret, enabled private-app
controller configuration and approval enforcement, one canonical platform origin
(`https://smart-deploy.xyz`) and a secure WebSocket URL on `ws.smart-deploy.xyz`.
It requires a 40-character source version and a current absolute expiry no more
than two hours away. `WS_PORT` defaults to4001 and accepts only valid unprivileged
ports. No listener opens when configuration is missing or invalid.

The configured controller exposes its already validated CA-file path and expiry
to this entrypoint. Before accepting a connection, the CLI closes any shared
session pool, removes connection-string SSL overrides, and configures that pool
with the operator CA and `sslmode=verify-full`, capped at two connections. The
controller's separate pool already uses explicit CA/hostname verification. The
operator files must be absolute, owned, private and mounted read-only; credentials
are never HTTP-health output or customer-app environment.

Only GET/HEAD `/` and `/health` provide HTTP health. Replies include mode
`private-app-demo`, exact source version, port and absolute expiry, with no-store.
Other application HTTP requests receive404. The server bounds header size/count,
connections and HTTP timeouts. At expiry it closes sockets, listeners and the
controller; SIGTERM does the same. The CLI gives cleanup three seconds before
exiting its own process. A timeout can leave an already admitted SQL mutation
uncertain; reconcile actual state. This process deadline does not stop AWS
resources and cannot replace the independent durable cleanup guard.

## Image and launch boundary

`Dockerfile.websocket` has a `private-demo` target with UID/GID10001 and the
dedicated entrypoint. The final `production` target inherits the original runner,
preserving the general worker's default command/user. The curated CodeBuild plan
selects `--target private-demo`; it still builds/pushes the same five images.

Do not boot the existing instance with public WebSocket ingress available: its
old container can restart automatically. Under the exclusive lease, record all
original groups, attach only the owned quarantine/gateway groups before starting,
and keep the worker closed while replacing the old container. The existing role
already has scoped read access to the existing server secret; retrieve it on the
instance into a private temporary file without echoing values or embedding them
in SSM command text. Keep the provider connections/secret contents unchanged.
Use a read-only container, dropped capabilities, no new privileges, a private
read-only operator mount and a loopback host mapping for the WebSocket port.

Observe actual health mode/version/expiry and local socket denial behavior before
restoring original public-facing groups plus the gateway group. Preserve unrelated
changes. Verify the legacy Nginx WebSocket TLS certificate separately. Initial
gateway selection, actual AWS build/catalog/data/bootstrap and observed automatic
worker/service/ALB/stack teardown remain separate release gates. Failed bootstrap
stays quarantined while the guard stops the instance; reconcile retained groups
and the lease after actual teardown.

## Verification boundary

Native HTTP/Socket.IO tests use real signed tokens and a controlled session
authority/controller. They cover current identity, revocation, forbidden events,
forged fields, deadline health, expiry and cleanup failure. Compiled-process tests
use fake catalog metadata, an unreachable database and no AWS credentials; they
cover generic startup failure, occupied-port preservation and actual timed exit.
A real pg client parses the forced CA/hostname configuration in the unit suite.
These do not establish production authentication or AWS readiness.

CI builds the actual private-demo target and requires non-root/read-only Linux
execution, exact image command/mode/version, denied internal HTTP endpoints and
SIGTERM completion. Local Docker is unavailable; only a passed exact-head CI
container result establishes that evidence. The user deferred the manual
two-account hosted sharing/revocation test. Keep it recorded as deferred.
