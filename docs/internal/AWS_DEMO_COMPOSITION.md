# Curated AWS demo composition

This slice renders infrastructure and a CodeBuild request. It does not provision,
start a build, start the worker, initialize data, register releases, or change
production configuration. It depends on the independent cleanup guard and the
curated notes application. It is not the general application deployment path.

`DemoWorkloadPlan` accepts one fresh demo namespace, one application, two separate
environment bindings and exactly three runtime/release/certificate tuples. The
two published runtimes share their published binding. All task images must be
digest references in that namespace's own immutable repositories. Public TLS
certificates are inputs; private keys and gateway credentials are never template
inputs. The document role trusts one explicitly verified same-account platform
principal and retains the broker's existing one-app transaction policy.

The build phase has eight resources: three repositories, three separate roles,
one retained encrypted DynamoDB table and one retained seven-day log group. The
runtime phase preserves those resources and adds an ALB with ACM HTTPS, two fixed
host routes, isolated published/preview groups and three quarter-vCPU Fargate
services. It also supplies a retained no-ingress quarantine group for worker
bootstrapping. Tasks run non-root with read-only filesystems, dropped capabilities,
no task role and no data volumes. Only the TLS container receives its own SSM
private key. Customer-app tasks receive no platform or AWS credentials.

Use two verified public subnets in distinct availability zones in the existing
VPC, with public task IPs. No NAT, database server, cluster or EC2 instance is
created. The existing exclusively leased worker is the gateway target on
8444/8445; attaching its gateway group and starting its actual gateway processes
are separate operator actions. Existing unrelated security groups must survive
attachment and cleanup. A fixed 403 health response checks target transport only:
it does not establish app readiness, identity, persistence or authorization.

Data, the document role and logs survive compute teardown. This is not logical
app deletion. Seven-day logical-deletion primitives remain separate; this
template does not wire an app-deletion or purge workflow. DynamoDB PITR is
disabled rather than adding another recovery policy. A new demo namespace creates a new table;
reuse/import of retained data across later demo windows is not implemented here.

## Rendering and validation

Compile with `npm run ws:build`. The two operator renderers require an existing,
bounded absolute JSON input path and a new absolute output path:

```text
node scripts/render-demo-workload.mjs ABSOLUTE_PLAN_JSON NEW_ABSOLUTE_TEMPLATE_JSON
node scripts/render-demo-build.mjs ABSOLUTE_BUILD_INPUT_JSON NEW_ABSOLUTE_REQUEST_JSON
```

The build input contains `workload` (a build-phase plan), a reviewed 40-character
`commitSha` and independently calculated full `archiveSha256`. The request uses
the existing NO_SOURCE `smartdeploy-builder` project with the new namespace's
restricted build role override. It downloads that public commit over HTTPS,
verifies the archive before extraction, builds five images, and pushes only to
the three owned repositories. The request fixes small Linux compute, a 15-minute
build timeout, a five-minute queue timeout, no retries/debug/artifacts/cache and
owned logs. Do not execute a generated request without the following admission.

The CI workflow compiles the narrow offline fixture, validates both template
phases with pinned cfn-lint and checks pinned CloudFormation Guard rules against
positive templates and negative mutations. Fixtures contain fake identifiers and
public certificates only; the helper destroys its temporary private material.
Cleanup IAM includes the actual resource-deletion handler dependencies, two
exact target-group names and listener rules. Its narrowly scoped PassRole is for
deleting task definitions; it has no RunTask/CreateService permission or app-data
deletion permission.

## Required live admission and acceptance

Before any AWS execution, establish a create-only exclusive worker/ENI lease;
verify the AWS account, current stopped worker, network ownership, DNS/certificate
and actual platform principal; arm and inspect the independent scheduled cleanup
with one shared expiry no more than two hours away. Verify the workload stack has
no persistent CloudFormation service role. Check a fresh itemized cost envelope
against the user's additional $10 limit, including retained resources and cleanup
contingency. Alerts and request limits are not a hard AWS billing cap.

Under the exclusive lease, record and preserve the worker's original security
groups. Before starting the instance, temporarily replace its attached groups
with the no-ingress quarantine and owned gateway groups. Do not expose public
WebSocket ingress until a runtime-only worker entrypoint has replaced the legacy
server and its actual health/mode has been verified. The legacy entrypoint also
registers general deployment/agent jobs and is not suitable for this cost-bound
demo. Restore the original groups together with the gateway group only after
that check, preserving any unrelated intervening groups. On bootstrap failure,
the guard stops the instance and removes compute/ALB; the retained quarantine
keeps it closed. Restore the recorded groups only after observed teardown and
lease reconciliation, then remove that unused quarantine group. Never leave a
failed bootstrap's legacy worker publicly reachable.

Reinspect the existing CodeBuild project before starting it. Reject extra
sources, environment secrets, secondary artifacts, VPC/fleet/Docker-server or
registry credentials. Do not modify its source connection or use its broad
default service role. Verify actual build completion and immutable ECR digests
before rendering the runtime phase. Initialize bounded environment quotas and
register only releases backed by genuine build/task/TLS evidence, never synthetic
successful deployments. Verify the dedicated role's positive/cross-app-negative
behavior and actual hosted gateway/version/persistence/redeployment behavior.

The user deferred the manual two-account hosted sharing/revocation test. Keep
that test marked deferred; automated auth/revocation coverage and machine-level
AWS smoke checks do not replace it. Observe automatic teardown through stopped
worker, zero services, absent ALB and absent workload stack. An accepted delete
request is not completion. No production-ready claim follows from rendering or
template validation alone.
