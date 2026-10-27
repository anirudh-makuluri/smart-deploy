# Workload TLS listener candidate

The app task needs a scoped TLS endpoint for the gateway's pinned connector.
`src/lib/workload-tls` supplies that endpoint using Node built-ins only. It does
not authenticate browser users or receive a platform/gateway service key. Keep
it behind app ingress that admits only the trusted gateway group. Do not expose
this listener as a public app origin or treat possession of its certificate as
permission to use an app.

## Transport and identity

Configuration requires one self-signed certificate with exactly the expected
binding/environment/release DNS name, a matching private key, current validity
dates and bounded explicit ports/limits. It rejects appended chains and another
workload's identity. The wire name matches `gatewayWorkloadServerName`:
`<binding-id>.<environment>.<release-id>.gateway.invalid`. Gateway verification
still requires the exact leaf pin; this is not a shared wildcard trust root.

Only TLS 1.3, the configured SNI and HTTP/1.1 ALPN can reach the app. There is no
default certificate for missing SNI. Validity is checked again before forwarding
each connection. Bytes go only to literal `127.0.0.1` at the configured app port;
no request header, URL or DNS result selects another destination. Bidirectional
pipes preserve bytes, backpressure and half-close behavior. The separate gateway
still enforces user access, strips credentials, supplies verified identity and
checks HTTP headers/cookies/body semantics.

Explicit input/output **wire-byte** caps include HTTP framing, alongside idle,
application-connection lifetime, handshake and connection-count limits. An
application cannot send unlimited chunk extensions around the gateway body cap.
These local connection bounds are not global usage or spending enforcement.
Handshake time is separately bounded; the application lifetime starts after it.
Graceful stop refuses new connections, allows a bounded drain and then destroys
remaining sockets, including unfinished handshakes. Existing connections are
not reauthorized by this task. The public gateway currently rejects upgrades;
this transport does not establish customer WebSocket support.

## Entrypoint and packaging

All settings are required; there is no provider-credential fallback:

| Environment field | Purpose |
| --- | --- |
| `SMARTDEPLOY_BINDING_ID`, `SMARTDEPLOY_APP_ENVIRONMENT`, `SMARTDEPLOY_RELEASE_ID` | Workload identity |
| `SMARTDEPLOY_TLS_CERTIFICATE`, `SMARTDEPLOY_TLS_KEY` | Scoped public certificate and private key |
| `SMARTDEPLOY_APP_PORT`, `SMARTDEPLOY_TLS_PORT` | Fixed loopback target and private IPv4 listener port |
| `SMARTDEPLOY_MAX_CONNECTIONS` | 1–32 TCP/TLS connections |
| `SMARTDEPLOY_TIMEOUT_MS`, `SMARTDEPLOY_IDLE_MS`, `SMARTDEPLOY_HANDSHAKE_MS` | Up to 30s lifetime / 5s idle / 5s handshake |
| `SMARTDEPLOY_SHUTDOWN_MS` | 0–5s drain |
| `SMARTDEPLOY_MAX_INBOUND_BYTES`, `SMARTDEPLOY_MAX_OUTBOUND_BYTES` | Up to 8 MiB / 64 MiB wire bytes per connection |

The entrypoint listens on IPv4 `0.0.0.0` only after validation. Startup failures
produce a generic message without config or key data. The app and listener ports
must differ. Per-task settings must also match the trusted launch descriptor,
app security-group rule and gateway's tighter HTTP/admission limits. SSM key
delivery and certificate creation are not implemented here.

`npm run workload:build` emits only `config.js`, `tunnel.js` and `main.js` under
`dist/workload-tls`. Build the image with that directory as the entire context:

```sh
docker build --platform linux/amd64 -f infra/workload-tls.Dockerfile \
  -t smartdeploy-workload-tls:ci dist/workload-tls
```

The image copies just those files into `/app`, runs as UID/GID 10001, and has no
application package dependencies. The Node distribution itself retains its base
image tooling. Runtime read-only filesystem/capability policy must be configured in ECS;
the container test explicitly uses read-only root, no capabilities, no new
privileges and resource limits. The candidate base is official Node 24.22.1
Linux/amd64 from Docker Hub, pinned to manifest
`sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420`.
Anonymous ECR Public and Docker Hub inspection verified identical manifest and
config SHA-256 identities and platform/version metadata. The first CI attempt
passed unit/build/native-process checks but ECR Public returned 429 data-limit
errors on its shared runner. Only the source registry changed; the image digest
is unchanged. This is not vulnerability-scan evidence. Image
publication/scanning, IAM and resource provisioning remain separate release work.

## Verification boundaries

Native tests use real loopback TCP/TLS and generated scoped certificates, including
the gateway's actual pinned connector. Compiled-process tests use only an explicit
workload environment. Windows process termination does not prove POSIX SIGTERM
handling; that branch is asserted by Linux CI. The separate Linux Docker test
builds the candidate, serves a real request, checks non-root/read-only settings
and `/app` contents, then verifies SIGTERM exit. Its host network connects only
test fixtures; it does not model Fargate/VPC isolation. It must fail if invoked
without a Linux Docker host rather than silently skip.

The compiled Next/Better Auth/PostgreSQL browser fixture now uses this actual
TLS-to-loopback transport between the gateway and its HTTP app. Its app content,
approval and verification remain controlled fixtures, not hosted AWS proof.
The listener has no production caller, trusted launch/registration adapter,
certificate lifecycle or active AWS ingress. Egress/complete $10 budget controls,
wake/idle, persistent resources/secrets/quotas, UI/tools, full Doctor >=95 and
complete hosted acceptance remain unmet.

Local checks pass 152 unit files / 1,087 tests (43 listener cases), two compiled
process cases, and all 15 compiled Next/PostgreSQL/browser cases through the new
transport. Typecheck, full lint, worker/standalone compilation, build and diff
checks pass. Removing both SNI guards causes the expected single backend-admission
regression; exact source restored. Initial strict-name projection/drain-admission
fixtures and Node type declaration gaps were corrected without relaxing TLS.
Fixtures/certificates are cleaned and the disposable database is stopped.

Complete pinned Doctor 0.9.18: eleven changed JS/TS files 100/100 with no findings;
full unfiltered 650-file report remains 84/100 with zero errors and the same
37 warning IDs across 26 files. No suppression or lowered threshold. Linux
container execution is not run locally because Docker is unavailable; it is a
required new CI check. Unchanged database suites pass in exact parent #120 CI,
while the changed compiled browser composition is repeated locally. Existing
filesystem tracing build warnings remain.

References: [Node TLS](https://nodejs.org/docs/latest-v20.x/api/tls.html),
[Fargate networking and task-local communication](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html),
[ECR Public pulls](https://docs.aws.amazon.com/AmazonECR/latest/public/docker-pull-ecr-image.html)
and [Node release status](https://nodejs.org/en/about/previous-releases).
