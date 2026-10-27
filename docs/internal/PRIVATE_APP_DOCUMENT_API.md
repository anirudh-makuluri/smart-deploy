# Private-app document adapter

`POST /api/gateway/documents` is a machine-only adapter for the single-app MVP.
It is disabled by default. It does not create AWS resources or initialize app
data, start a runtime, publish an app or expose a browser-facing data URL.

Apply the existing app/workspace, gateway/session/environment and runtime
registration migrations first. `PRIVATE_APP_DOCUMENTS_ENABLED=true` additionally
requires one explicit `APP_DOCUMENTS_APP_ID` and a full
`APP_DOCUMENTS_TABLE_ARN` in the configured AWS region. The backend must have
least-privilege access to that ARN. Confirm the actual IAM principal before
enabling; a configuration value alone is not IAM evidence. No environment value
is copied from customer DeployConfig or returned to the app.

The normal gateway service credential, exact binding assertion, HTTPS and
browser-credential rejection still apply. The body contains a session token,
action, collection and document ID. `put` additionally requires JSON and an
explicit expected version (null for creation); `remove` requires a version.
App/environment/user/table overrides are rejected. The store derives scope and
identity in one current SQL snapshot, requiring a managed selected runtime,
verified identity, live platform/app sessions and current app/environment
permissions. Ordinary members can use only granted published apps. The existing
invited-member waiting-list exception is reapplied; management access does not
inherit that exception. No app data is read before these checks.

The adapter supports `get`, `put` and `remove` only. It does not offer arbitrary
AWS commands, scans, collection listing, initialization, app deletion/recovery,
physical purge or secret access. Existing transactional versions, quotas and
deleted-data policy remain in AppDocumentStore; preview/published data is separate
and releases do not enter the document namespace.

The complete HTTP operation has a four-second deadline. Bounded JSON parsing
accepts at most 32 KiB of actual bytes for the escaped 8-KiB document envelope;
other gateway APIs keep their 4-KiB limit. Cancellation reaches the body reader
and every DynamoDB command. The SDK has one attempt, explicit AWS HTTPS endpoint,
bounded connection/request timeouts and socket count. Each process admits at most
two storage operations and retains admission until actual settlement, then
destroys the request's client. This is not a global request, egress or spending
limit; the bounded demo controller/gateway must supply those controls.

A timeout or unavailable response can still follow a committed transaction.
Clients must reconcile the current document rather than blindly replay mutations.
No backend retry or success assertion is manufactured after an ambiguous result.
SQL authorization and DynamoDB commit are separate operations; an already-admitted
request can finish while permissions change. Whole-app deletion still needs its
coordinator to revoke routing/credentials and advance the data lifecycle generation.

The native gateway's browser-to-data adapter and actual private runtime loader,
operator initialization, bounded demo infrastructure/cleanup and hosted acceptance
remain subsequent integration. Do not turn this flag on as a substitute for
those steps. Better Auth/Supabase platform dependencies remain unchanged; no
production configuration, migration or billable resource is changed by the code.

Local verification: 161 unit files / 1,157 tests, 10 PostgreSQL files / 151 tests,
33 real DynamoDB Local cases, two compiled native TLS process cases, 15 compiled
private-app browser cases and five compiled public/analytics browser cases pass.
Typecheck, lint, production and worker/workload builds pass. Complete unfiltered
React Doctor 0.9.18: 100/100 across 674 files, zero errors/warnings/skips. Removing
the managed-runtime SQL guard makes its regression test fail. These checks use
disposable local fixtures, not a live AWS or hosted end-to-end deployment.
