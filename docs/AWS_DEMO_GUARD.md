# Bounded AWS demo cleanup

The curated MVP retains ALB/ACM and the approved additional $10 monthly budget.
Its independent guard is a **Step Functions Standard workflow** with native AWS
SDK integrations. No Lambda or Scheduler resource is created, no Lambda
concurrency is reserved, and the existing regional Lambda limit can remain 10.

`node scripts/build-demo-guard.mjs OUTPUT_JSON` renders a compact CloudFormation
template without AWS calls or secret resolution. It hashes the reviewed
`scripts/demo-cleanup-workflow.mjs` source and creates one Standard machine,
execution role, retained seven-day logs and encrypted failure queue, EventBridge
failure rule and queue policy. It creates no application runtime/data resource.
Use the compact renderer output to stay within the 51,200-byte inline limit.

## Arming contract

Use `demoGuardParameters` with one trusted manifest and the admission clock. It
derives resource identities and both timestamps together. Allocate a new 80-bit
demo ID; never reuse a failed/completed namespace. The shared expiry must be
rounded to a whole second, more than five minutes and at most two hours away.
Only `apps.smart-deploy.xyz` is accepted. Preview has a separate binding; both
published revisions share theirs. IDs come from the prepared plan, not browsers.
Existing Better Auth/Supabase dependencies remain unchanged.

Before billable build/runtime startup:

1. Establish create-only exclusive worker/primary-ENI leases; record original
   groups and verify the AWS account, network and stopped worker.
2. Admit an itemized cost envelope including Standard state transitions,
   retries, build/runtime/transfer, retained resources and cleanup contingency.
   Do not assume free tier or claim a hard billing cap.
3. Validate the actual template with pinned cfn-lint/Guard and an unexecuted
   change set; inspect `describe-events` validation before executing it.
4. Inspect actual definition/source/configuration, role/trust, logging and
   failure delivery. The workload stack must have no persistent service role.
5. Start exactly one execution, with **name equal to the demo ID** and input
   exactly `{"mode":"cleanup"}`. Observe its actual `RUNNING` status and
   `ExpiryTimer` wait with the matching expiry in execution history. A created
   state machine alone is not armed.

CloudFormation binds the targets/account/region/deadline; execution input cannot
override them. Another execution name or machine, expired/overlong admission and
mismatched timestamp parameters fail before AWS calls. Standard execution names
cannot be reused for 90 days; together with the exact-name check this prevents a
second normal execution for a demo. Never weaken that check or update a definition
under an active demo; a running execution retains its original definition.
The durable wait survives operator/chat disconnection and consumes no Lambda slot.

## Ownership and cleanup

At expiry, independent branches attempt the leased worker, exactly three owned
ECS services, the owned ALB, six named/tagged gateway/TLS-key parameters and the
workload stack. A denied/invalid branch returns incomplete while peers continue.
Service/parameter maps admit at most two operations each. SDK tasks have 10-second
workflow timeouts and no added task retries. The outer loop re-observes at most
30 rounds with 60-second delays, ending at expiry plus 30 minutes. A 9,300-second
workflow backstop covers the maximum timer plus cleanup/drain window.

Every mutation has a fresh deadline check immediately before it. A late read
cannot admit another mutation. A timed-out AWS write can still commit; reconcile
actual state. Permission/ownership failures are never treated as absence.

Worker stop is independent of stack inspection. Running/pending workers require
the matching lease; an already stopped worker can be observed without mutation.
Stack cleanup checks exact name/ARN/tag, no service role, bounded inventory and
no pagination. Before detaching `GatewayGroup`, verify its ownership and the
leased ENI's actual owner, primary attachment and tags. Read current groups,
remove only that gateway group and preserve all other groups, including unrelated
and quarantine groups. Reject an empty replacement. EC2 group replacement has no
compare-and-swap; the exclusive lease must exclude concurrent network writers.

Services need exact prepared names/ARNs and tags before scaling to zero. Exact
INACTIVE records with zero desired/running/pending tasks can be observed after
tags disappear and are never mutated. ALB name/ARN/tags must match. Parameters
are checked by deterministic name/tag; their values are never read. Only fixed
typed missing-resource errors count as absence. A CloudFormation validation error
must also identify the exact missing stack; unrelated errors do not qualify.
The native CloudFormation SDK reports a missing stack as
`CloudFormation.CloudFormationException`; this case is accepted only with the
exact prepared stack name in the missing-stack cause. Other generic service
errors remain incomplete.

The role retains the reviewed worker/ENI IAM lease conditions and namespace-scoped
infrastructure deletion dependencies. It cannot start instances, create services,
run tasks, delete application tables/buckets or read secret parameters. Trust is
restricted to this machine ARN/account. CloudWatch delivery APIs require resource
`*`; their actions are limited to documented delivery operations in this region.

This is compute cleanup, not logical app deletion. Application data, its scoped
role and workload logs remain retained. The separate seven-day data lifecycle
is unchanged. Quarantined bootstrap before waking the old worker remains required.

## Completion and evidence

Success requires observing a stopped worker, all services absent/zero, absent
ALB and workload stack, and cleared owned runtime parameters. Accepted updates/
deletes return incomplete; a later round must observe terminal state. Exhausting
the window fails. Standard execution history is authoritative; inspect actual
AWS resources before releasing leases.

ERROR CloudWatch logs exclude execution data. FAILED/TIMED_OUT/ABORTED events
target the retained encrypted queue with only execution ARN/status and no email.
EventBridge/log delivery is best effort; neither replaces history or resource
inspection. Never remove the guard or stop its execution while billable resources
remain. After observed completion, reconcile original groups/quarantine, remove
the control plane and release only this demo's leases. Preserve diagnostics before
removing retained logs/queue. Existing baseline storage/IP charges can remain.

## Verification boundaries

Graph tests use patched JSONata 2.2.2 with the AWS-supported language subset and
controlled AWS transport/clock. AWS-native validation/TestState are separate
checks against the managed service. Graph cases cover
input/name/clock binding, timer, observed completion, all mutation deadline paths,
group preservation, ownership refusals, permissions and independent cleanup.
The small graph fixture is not an AWS emulator or deployed IAM/network proof.
Artifact/parameter tests cover the native template and clock/manifest binding.
The old inline Lambda artifact test is replaced by native graph/timer evaluation.
The legacy `DemoCleanup` helper/SDK tests remain as an operator/reference helper;
no Lambda is emitted or invoked by the new production guard.

Pinned cfn-lint 1.58.0 and Guard 3.2.1 check the schema and six security rules. Nine
negative mutations cover workflow type/timer, unbounded execution, retry spin,
trust, ownership, audit encryption and application-resource injection. AWS native
definition validation and strict mocked TestState schema checks are additional
evidence. Initial duplicate nested state names were repaired before the native
validator passed without diagnostics. Actual deployed SDK/IAM behavior and timed
teardown remain separate acceptance gates; the user-deferred manual two-account
hosted test stays deferred.
