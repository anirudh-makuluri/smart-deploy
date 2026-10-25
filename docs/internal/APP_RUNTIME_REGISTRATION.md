# Private app runtime registration

This is control-plane metadata for the AWS-only pilot. It does not start a
server, provision AWS resources, expose an API or enable private apps in production.
Apply `20261025_app_runtime_registrations.sql` after the app/workspace, gateway
credentials, platform-session and gateway-environment migrations. The migration
is additive and rerunnable. Deploy it before code that calls its authentication
functions. Older gateway migrations install their baseline functions only when
absent, so rerunning them cannot downgrade the runtime policy.

## Registration and selection

`AppRuntimeStore` allocates a fresh UUID hostname per app/environment binding.
Managed identities cannot be edited or converted from old bindings. Hostname
tombstones survive binding deletion: a previously used origin must never be
reassigned to different customer code, including code with a root service worker.
Existing unclassified bindings retain their old authentication behavior; this is
compatibility, not permission to convert an existing public deployment to private.

Only a fresh owned deployment with no cloud resources, active run, first deploy
or legacy secret reference can be associated with an app/environment. A runtime
references the successful finished deployment run and its `release_artifact`
snapshot. `DeployConfig` remains the deployment source of truth. Registration
checks matching app/workspace, AWS/ECS region/account/cluster, deployment identity,
repository/service/commit, image digest, private address, TLS identity and live
exclusive gateway credential. It returns no DeployConfig or secret values.
Registered release snapshots and deployment associations become immutable;
existing logs can still be updated. Registration holds source locks, including
against an update waiting concurrently for registration to finish.
Foreign keys restrict deletion of registered sources, credentials and activating
users. A later explicit resource-retirement/cleanup path must remove those
references in order, while preserving the hostname tombstone; this slice does
not silently cascade a live runtime out of existence.

Activation requires current verified owner/admin membership and an expected
current runtime ID. The workspace lock serializes competing selections. The
transaction switches the app/environment route, revokes the previous selected
key and retires the previous runtime. Retries selecting the same runtime are
idempotent. Pending and old runtime keys cannot authenticate, even if the binding
itself is enabled. Browser authorization also rejects a managed binding with no
live selected runtime. Selection keeps an existing binding's app sessions; every
subsequent request still checks current app permissions through the gateway.

Preview and published routes and credentials are independent. No documents,
files, secrets or secret references are copied between them. Publishing code must
use separately configured published resources. `deactivate` means unpublish and
retire; it is **not** an idle-stop operation. A later wake controller must retain
desired published release state while compute is stopped and handle expired
credentials explicitly.

## Trust boundary and unfinished integration

These are privileged server primitives, not request authentication adapters.
Management adapters must resolve a fresh platform session, verified email,
waiting-list approval and workspace role before invoking them. SQL verification
in the store does not replace those checks. Client and `service_role` table
writes are denied; the latter can read runtime metadata for gateway authorization.
Invoker-rights functions do not grant registration privileges.

Registration validates metadata consistency. Its caller must independently
verify actual ECS task state, pinned images for **all** task containers, ENI IP,
VPC/subnet/security groups and private ingress before calling `register`. The
observed digest argument is not AWS attestation. The computed SSM parameter path
is a name, not proof that a credential exists or has been delivered safely.
No production caller, AWS attestation, credential/certificate provisioning,
run-association adapter or runtime startup/reconciliation loader exists yet.
The HTTPS factory in `GATEWAY_NATIVE_HTTP.md` must consume only trusted current
registrations, never hostnames or endpoint metadata supplied by a browser.

WebSockets, private AWS ingress, wake/idle and complete $10 budget enforcement,
isolated DynamoDB/S3/secrets with quotas, product UI/tools and hosted acceptance
remain unfinished. The full repository Doctor score also remains below 95.
This slice is not a production release gate pass.

## Verification

The real PostgreSQL suite tests pending-key denial, legacy compatibility,
idempotency, source and endpoint mismatches, role/verification checks,
compare-and-swap races, source-update races, immutable identity, privilege denial,
fresh-origin allocation, retirement, environment separation and migration reruns.
The existing compiled Next/Better Auth/PostgreSQL/HTTPS browser fixture now applies
the new migration as well; its legacy fixture bindings do not exercise an
AWS-registered runtime. Local TLS and SQL fixtures are not hosted AWS proof.

Local validation passes 150 unit files / 956 tests, nine PostgreSQL files / 134
tests (27 registry cases), 15 compiled production browser cases, typecheck,
lint, worker compilation, build and diff checks. Removing the session
availability predicate produces the expected unpublish regression. The source
is restored. A fixture PID typing error was corrected. Two initial Doctor Zod
migration warnings were fixed with `z.looseObject`; all 27 affected database
tests and all 15 compiled browser tests pass again afterward. Final focused
schema lint supplements the earlier full lint pass. The existing filesystem
tracing build warning remains. All fixture servers stop and TLS files are
removed; the disposable PostgreSQL server is stopped after verification.

Pinned Doctor 0.9.18: all six changed JS/TS files score 100 with no findings.
The complete unfiltered repository report remains 84, zero errors and the same
37 warning IDs across 26 files. There is no suppression or threshold change;
the required full score of at least 95 is still unmet.
