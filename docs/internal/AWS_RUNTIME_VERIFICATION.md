# Read-only private runtime verification

`PilotRuntimeVerifier` inspects AWS evidence for the initial private-app pilot.
It does not create resources, register a runtime, enable a feature flag or start
the worker. No production caller exists yet. Expectations must come from a
trusted launcher and the app's release snapshot, never browser-supplied metadata.
The configured TLS image and execution role must be curated by the operator.

## Evidence and fixed pilot profile

The verifier uses the repository's AWS client configuration, an explicit region,
two SDK attempts and bounded HTTP connection/request timeouts. It describes one
exact task and revision, task-definition tags, the task ENI/subnet, both complete
security groups and interfaces using the gateway group. It describes the task
again after those reads to catch shutdown or task-address drift. Only Describe
commands are used. A per-instance pending cap, deadline and caller cancellation
apply to all reads. Admission remains occupied until SDK work actually settles,
including a transport that ignores cancellation. Close aborts work and destroys
the SDK clients. Failures expose no raw provider errors or container environment.

This profile deliberately supports Linux/X86_64 Fargate platform 1.4.0 at
256 CPU units / 512 MiB with default 20 GiB ephemeral storage. It rejects ECS
Exec, task IAM roles, shared volumes/PID/IPC, unsupported overrides and extra
containers. There must be exactly two essential containers, `app` and `tls`,
with matching running status and pinned ECR image references/digests in the
configured account/region. The TLS image comes from trusted configuration;
customer configuration cannot choose it. The TLS container runs as a numeric
non-root user with a read-only root filesystem and its image's entrypoint.
Image-index versus platform-manifest digest differences are not silently
accepted; a supported release must supply the actual platform image digest.

App, binding, environment, release and runtime tags must match the expectation.
Tags supplement exact task/definition identities; they do not authenticate a
browser or establish cloud ownership by themselves. The task must have no app
IAM role: deployed data access is intended to use the quota-enforcing broker.
The execution role reference must match the trusted launcher. Its actual IAM
policy still needs separate infrastructure review.

The candidate secret contract permits only app/environment SSM references under
`/smartdeploy/pilot/apps/<app-id>/<environment>/...` in the app container. The
TLS container can receive only `SMARTDEPLOY_TLS_KEY` from its exact
`/smartdeploy/pilot/workloads/<binding-id>/<runtime-id>/tls-key` parameter.
No gateway parameter namespace, cross-environment reference, environment file,
duplicate env/secret name or AWS/gateway credential environment name is allowed.
This checks references, not values, encryption, IAM permissions or delivery.
No parameters or roles have been provisioned. Existing non-pilot deployment
secret behavior remains separate.

## Network boundary

The task attachment must identify a private IPv4 in an approved subnet. EC2 must
confirm the same AWS-managed ENI, owner, VPC, subnet and IP, with only the expected
app security group. IPv6 is unsupported in this first profile. That group's
app/binding/environment tags must match. Its complete ingress must contain just
one TCP port rule from the configured gateway group and account, without CIDRs,
prefix lists, broad ranges or peering. An extra attached task group is rejected.

The gateway group must belong to the same account/VPC. Its group-filtered ENI
query must return exactly the configured primary gateway interface attached to
the trusted instance. A second interface, unexpected instance or pagination
token fails closed. A gateway-group attachment on an untrusted task would defeat
source-group isolation, so inspecting only the app group's rule is insufficient.
Public task addresses for image pulls are not treated as public application
ingress permission; the app rule must still admit only the gateway group.

These are point-in-time, non-atomic AWS metadata checks. They do not prove
continuous policy, successful TLS handshakes, readiness or direct-origin denial
on a live deployment. Least-privilege IAM must prevent untrusted security-group
changes. The final controller must bind this evidence to the current immutable
release, guard changes between SQL reads and registration, prove the expected
workload certificate over the actual private route, and revalidate as needed.
Do not activate a runtime solely because this method returned an observation.

## Remaining gates and verification limits

This does not enforce egress or the $10 budget. Arbitrary outbound app traffic
would bypass broker-level byte quotas; the final network/cost design must bound
that traffic before provisioning or claiming a spending cap. A public-subnet
network with security groups alone is an incomplete cost-control design.
The trusted launcher must also generate the TLS container's arguments and
environment; this inspector does not prove their application-level semantics.
Credential/certificate provisioning, trusted runtime image, launch/recovery and
idle orchestration, budget admission, actual IAM/ingress plans, WebSockets,
isolated persistent data/secrets, product UI/tools and hosted acceptance remain.
The full Doctor score of at least 95 is also still a release gate.

Tests exercise the real verifier and SDK command objects with synthetic SDK
responses. They cover images, source/context mismatches, task shutdown/drift,
credential and storage boundaries, public/shared ingress, partial results,
pagination, redacted failures, bounded admission, cancellation and late results.
They do not call AWS, test SigV4/real IAM permissions, launch a container or prove
that the proposed profile matches a live Fargate task. Installed SDK types and
current AWS documentation inform the contract; live positive/negative tests are
required before release.

Local checks pass 151 unit files / 1,044 tests, including 88 new verifier cases;
typecheck, full lint, worker compilation, configured production build and diff
checks. Removing the public IPv4 ingress predicate produces the expected single
regression, with exact source restored. The initial test-only Node environment
override conflicted with shared window setup; using the repository's normal
environment fixes that fixture failure. No check was suppressed. The build uses
only the explicitly configured disposable database with feature flags off, then
stops it. Full-suite TLS fixtures are removed and no local servers remain.

Pinned Doctor 0.9.18: six changed JS/TS files 100/100, no findings; full unfiltered
640-file report 84/100, zero errors and the same 37 warning IDs across 26 files.
The full >=95 requirement remains unmet. Unchanged database/browser suites pass
in exact parent #119 CI; they are not separately repeated locally for this
read-only component. The manifest records these proof boundaries.

[WORKLOAD_TLS_LISTENER.md](WORKLOAD_TLS_LISTENER.md) describes the candidate
task-local transport and image. It still needs a trusted launch/controller,
actual AWS TLS/ingress verification and the remaining release gates.

AWS references: [task description](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html),
[task-definition description](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTaskDefinition.html),
[Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html),
[security-group description](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSecurityGroups.html),
[task parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
and [task IAM roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html).
