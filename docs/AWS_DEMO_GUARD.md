# Bounded AWS demo cleanup

The user-flow MVP retains ALB and ACM and has a time-boxed, additional $10 monthly
budget. `scripts/build-demo-guard.mjs OUTPUT_JSON` renders an independent cleanup
stack from the reviewed TypeScript implementation. Rendering provisions nothing.
The source hash is included in the template metadata and outputs; inline code has
no repository-relative imports. This slice is preparation, not an enabled pilot.

## Arming contract

Use `demoGuardParameters` with one trusted manifest and the current admission
clock. It derives all resource identities and both schedule times together. A new
80-bit demo ID is mandatory; never reuse it. The absolute expiry must be more than
five minutes and no more than two hours away, rounded to a whole second. Only
`apps.smart-deploy.xyz` under the existing domain is accepted. Preview has its own
binding; both published revisions share the published binding. Parameter UUIDs
must come from the trusted prepared app/binding/release plan, with fresh
preallocated runtime IDs. They must not come from a browser request.

The cleanup stack is separate from `sdp-demo-<demo-id>`, the workload stack it
deletes. It creates only its schedule group, schedule, Lambda, delivery policy,
roles, encrypted dead-letter queue and seven-day logs. It does not create an ALB,
ECS task, database, certificate, secret, or instance. The schedule runs once per
minute from the shared expiry through the next thirty minutes. Delivery age and
retries are bounded separately. The Lambda has concurrency one, a sixty-second
AWS limit and a forty-five-second application deadline. All SDK clients have
explicit regional HTTPS endpoints, bounded retries/timeouts and two sockets.

Before starting any billable workload, the launcher must create and validate this
stack, inspect its actual deployed schedule/function/policy/source hash, and
invoke it before expiry to observe `armed`. An unexecuted CloudFormation change
set with `describe-events` validation is still required for the actual manifest.
This PR does not implement that provisioning/admission controller. Do not enable
the pilot merely because local validation passes.

## Resource ownership and teardown

Cleanup checks account, exact names/ARNs and the `smartdeploy:demo-id` tag before
mutation. Existing worker and primary ENI changes additionally require matching
IAM-enforced ownership leases. Read the current ENI groups immediately before
removing only the workload stack's tagged `GatewayGroup`, preserving the other
groups in that read. EC2 group replacement has no compare-and-swap operation:
the demo lease must exclude concurrent network writers. Never retag shared
resources to bypass an ownership failure.

Independent stop paths attempt the leased worker, exactly three tagged ECS
services, the one tagged ALB, and six named/tagged SSM gateway/TLS-key parameters.
They run even if another stop path fails. Worker stop does not wait for stack
inspection. No parameter values are read. A delayed SDK response after the
deadline cannot initiate another mutation. Service and parameter batches are
fixed at three and six operations; each SDK transport admits at most two sockets.

The workload stack must use implicit caller credentials (no CloudFormation
service role), at most fifty resources, exactly the known services, and no
standalone `RunTask` or autoscaling. Its resource names, tags and delete operations
must fit the rendered cleanup role. The role has no start, terminate, provision,
application-table deletion or object-store deletion permission. Retain application
data in the workload template; the separate seven-day lifecycle governs recovery.
This guard deletes runtime credentials, not retained user documents.

`pending` records requested cleanup. `complete` requires observing a stopped
worker, zero running/pending service tasks, absent workload stack and absent ALB.
An exact-name INACTIVE service record with zero desired/running/pending tasks can
remain after deletion and tag removal; it is only observed and never mutated.
An accepted API request is not completion. Permission/ownership failures remain
failures; they are not treated as resource absence. The cleanup stack does not
delete itself or its evidence. Inspect logs and both delivery failure paths; on
failure, use the owned-resource runbook and verify terminal AWS state manually.
After actual completion, remove the schedule/control plane and release only this
demo's worker/ENI leases. Retained queue/log resources still need later cleanup.

## Verification and limits

Run the focused unit suites for `demoCleanup`, `demoCleanupHandler`,
`demoGuardTemplate`, and `demoGuardParameters`. They cover ownership preservation,
independent failure paths, idempotent observed terminal state, mutable input,
expiry/clock binding, transport cancellation and late replies. A generated inline
CommonJS Lambda is executed with the real local SDK and the resolved template
environment before expiry; no AWS requests are issued by that test.

Validate the rendered template with cfn-lint 1.58.0 and
`node scripts/verify-demo-guard.mjs CFN_GUARD_PATH REPORT_JSON` using official
cfn-guard 3.2.1. All six custom rules must pass, and all eight unsafe template
mutations must fail the expected rule. CI installs pinned isolated validators;
the official Guard archive checksum is verified before execution.

Live read-only Access Analyzer checks found no findings for the cleanup identity
policy, scheduler identity policy and both roles' trust policies. IAM simulation allows the
specific worker stop and primary ENI modification with the correct lease and
denies them with another lease. Simulation does not establish deployed role trust,
CloudFormation deletion permissions, network behavior or actual cleanup.

Automatic teardown reduces exposure; it is not a hard AWS billing cap. Failures,
request traffic, retained data/logs, builds, images and transfer can still cost
money. Resource-count, egress, request/storage quotas, full cost admission, actual
workload template compatibility, deployed guard verification, and hosted
creator/member/outsider acceptance remain release requirements. The feature flags
remain off and the existing worker remains stopped in this increment.
