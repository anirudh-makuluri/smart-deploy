# Trusted prepared-runtime selection

The AWS worker now has a default-off `apps:runtime` acknowledgement channel for
the curated three-runtime demo. It composes the existing release preflight,
read-only AWS verifier, pinned workload TLS, registration and compare-and-swap
selection. These checks run on the worker inside the VPC, rather than trying to
reach private task addresses from the hosted Next.js platform.

Enable only with `WORKSPACE_APPS_ENABLED`, `PRIVATE_APP_GATEWAY_ENABLED` and
`PRIVATE_APP_PUBLISH_ENABLED`, plus an absolute `PRIVATE_APP_PUBLISH_CONFIG` path.
The operator file contains `{runtime, databaseCaFile}`. `runtime` follows
`RuntimeControlSettings`: a fixed AWS scope, one app ID, absolute expiration and
exactly two published releases sharing a binding plus one separately bound
preview. Runtime/release/task/credential IDs must be unique as appropriate.
Certificates must match their binding/environment/release. Operator files are
bounded and the production bootstrap accepts only `apps.smart-deploy.xyz`.
Configuration creates no AWS resources and is not a provisioning/teardown guard.

Browser messages contain only an action, correlation ID and app ID; activation
also requires environment, release ID and the expected current runtime ID (or
null). Extra identity/cloud fields are rejected. The server takes user/session
IDs exclusively from the authenticated socket. Existing origin, token and
per-packet/idle session guards remain in force. The dedicated controller also
checks the actual live session and current verified/approved identity through a
separate bounded PostgreSQL pool using explicit CA and hostname verification;
connection-string TLS overrides are removed. Workspace manager checks occur in
the source preflight and final store mutations.

Selection performs the following checks before changing the route:

1. Read the current authorized release and matching DeployConfig source snapshot.
2. Derive AWS image/identity expectations from that snapshot. Independently read
   bounded task/network evidence and the exact prepared SecureString credential.
   Observe both results with `allSettled`; an early failure cannot release the
   admission slot while the peer read remains active.
3. Check SSM name/ARN/version-one/key ID against the live SQL hash, binding and
   exact demo expiry, then probe the actual private endpoint with its pinned TLS
   certificate. The public gateway authentication SQL function stays unchanged:
   it still rejects a prepared credential before its runtime is selected.
4. Recheck session/verification/approval and current manager/source preflight.
   Preserve the original fingerprint; reject drift rather than replacing it.
   Register using the original fingerprint and observed image digest.
5. Recheck the session again and activate with compare-and-swap against the
   expected current runtime. The store retires the previous runtime/credential.

Inspection returns only prepared release labels/IDs, the selected runtime IDs,
generation, canonical HTTPS public origins and selection eligibility. It omits
private addresses, task/role/parameter ARNs, credentials, certificates and build
configuration. Eligibility means source/credential state, not a live application
health claim. Gateways reconcile selections asynchronously. UI wiring, actual
gateway observation and hosted acceptance remain separate release requirements.

One controller operation is admitted at a time. The fixed three-entry SQL
inspection uses the dedicated pool's two-connection bound. A 15-second controller
deadline, 20-second acknowledgement bound, caller disconnect, fixed at-most-two-
hour demo expiry and close all retire pending work. Admission remains held until
actual work settles, including noncooperative reads. Expiry stops control and
closes clients/pool; independent durable AWS cleanup is still required. The
channel never provisions resources or copies preview data/secrets. An already-
admitted SQL mutation can commit during a timeout/disconnect; failed or missing
acknowledgements require state reconciliation before another attempt.

Final serial local verification: 168 unit files/1,287 tests (34 new), ten real
PostgreSQL files/155 tests (two new), 33 DynamoDB Local cases, two compiled gateway
and two workload process cases, all 15 compiled private and five public browser
cases pass. Typecheck/full lint/private+public production builds/worker+workload
compilation pass. Complete unfiltered Doctor0.9.18:100/100 across698files,zero
errors/warnings/skips,no suppression. Owned database and fixtures stopped.

The new PostgreSQL/TLS test selects two prepared releases, proves prepared keys
are initially unauthenticated, preserves a colleague's app session across the
change, retires the old key and keeps grant revocation effective. SQL and TLS are
real; AWS task evidence and SSM responses are controlled fixtures. Socket tests
verify actor derivation, strict payloads, isolated acknowledgements and late/
cancelled/configuration-failure paths. Bootstrap tests verify explicit TLS,
feature/domain gates and fresh session/approval checks. Initial fixture/schema
projection errors and a clock-boundary assertion were repaired. Four initial
Doctor findings were repaired with bounded independent reads and Set lookups;
critical preflight/authorization/write ordering remains sequential.

This is a prepared-runtime controller, not an arbitrary-app launcher or finished
MVP. The operator must still provision/verify bounded resources and a real
release catalog, bootstrap the initial selections/gateway processes, wire the
creator UI and verify actual app versions, isolated persistent data and access
revocation on AWS. No provider connection, production configuration/migration/
account/invitation/email/data, billable resource, worker startup, rollout merge
or deployment changed. Billing #85 and the deferred agent flow remain separate.
