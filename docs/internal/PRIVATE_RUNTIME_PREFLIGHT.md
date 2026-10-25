# Private runtime source preflight

An unchanged image digest does not establish that a release still has the same
deployment configuration. Before checking AWS task/network evidence or workload
TLS, a trusted launch controller must call
`AppRuntimeStore.prepare(bindingId, releaseId, actorId)`. Registration now requires
its `sourceFingerprint` as `expectedSourceFingerprint`; omission has no fallback.

The short transaction checks the current verified workspace manager, managed
binding, successful finished AWS/ECS release and matching deployment environment.
It returns only binding/release/deployment identifiers, the pinned image reference
and digest, and a SHA-256 fingerprint. It never returns history's configuration or
secret references/values. A management adapter must still require a fresh
approved platform session; the store is a privileged primitive, not an HTTP API.

The fingerprint covers the complete release artifact, including unrecognized
configuration fields, release ownership/source/app/workspace/completion state,
deployment ownership and app/workspace/environment/provider/target/region/source
association, and the binding's identifiers/environment/origin. PostgreSQL's JSONB
text representation makes object key ordering irrelevant. Completion is a
boolean: refreshing an already-finished timestamp does not change the snapshot.
Operational log/status/timing fields outside the artifact are excluded.

After external checks, `register` locks and validates the source again, recomputes
the fingerprint and rejects drift with 409 before inserting a registration.
Existing registration triggers protect the committed release snapshot against a
concurrent update waiting for those locks. Never hold this SQL transaction open
while waiting for AWS or a network probe. On drift, prepare again and repeat the
external checks; do not merely replace the expected fingerprint after observation.

This fingerprint is a consistency assertion, not an authentication credential,
AWS attestation or readiness result. No production caller is added. The trusted
controller still needs to compose the read-only AWS verifier, pinned TLS probe,
credential/certificate lifecycle, budget admission and route selection. Preview
and published resources remain separate; nothing copies their data or secrets.
There is no migration, AWS call, provisioning, runtime startup or deployment.

The database tests cover manager/verification denial, minimal projection,
unchanged-image configuration drift, deployment-association drift, canonical JSON
ordering, cross-environment replay and required fingerprint validation, alongside
the existing source-update/selection races and immutable registration checks.
See the accompanying remediation manifest for final local evidence and remaining
release gates. Local SQL/browser fixtures are distinct from hosted AWS proof.

Local verification: 152 unit files / 1,087 tests, nine PostgreSQL files / 146
tests (39 registry cases, 12 new), two compiled workload process cases and all
15 compiled production browser cases pass. Typecheck, full lint, worker/workload
compilation, production build and diff checks pass. Removing the fingerprint
comparison causes the expected stale-configuration failure; exact source is
restored. The JSON-order fixture's initial TypeScript annotation was corrected
without changing a runtime predicate. Existing build tracing warnings remain.
Fixture servers/certificates are cleaned and the disposable database is stopped.

Pinned Doctor 0.9.18: complete three-file scan 100/100 with no findings; complete
unfiltered 650-file scan remains 84/100, zero errors and identical 37 warning IDs
across 26 files. No suppression or threshold change. Full >=95 and the remaining
pilot release gates are still unmet. Docker is unavailable locally; the unchanged
container passes in exact parent #121 Linux CI. No AWS or hosted proof is claimed.
