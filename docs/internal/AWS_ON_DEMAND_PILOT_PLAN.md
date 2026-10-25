# AWS on-demand pilot candidate

Status: design/cost research, not a provisioned or deployment-ready runtime.
The user approved the existing domain, up to $10/month additional AWS spend,
on-demand startup/idle shutdown, and DynamoDB documents plus S3 files. Existing
Better Auth/Supabase/control-plane hosting remains. This plan supersedes the
earlier always-available gateway/load-balancer proposal for this budget.

## Current evidence

Read-only AWS CLI inspection on October 25, 2026 UTC found the existing Oregon
worker stopped, an existing ECS cluster, and no load balancers or available NAT
gateways to reuse in its VPC. The worker is t3.small with IMDSv2 required; its CPU
credit mode is unlimited. No instance, security group, credential, provider
connection or other cloud state was changed. A startup guard must require
standard CPU credits before claiming a bounded compute estimate.

AWS Price List GetProducts results for us-west-2, with Decimal calculations:

| Item | Public on-demand rate | Illustrative cost |
| --- | --- | --- |
| One Application Load Balancer | $0.0225/hour, before LCUs/IPv4 | $16.425 for 730 hours |
| Two Application Load Balancers | Same rate per balancer | $32.85 for 730 hours |
| Existing Linux t3.small | $0.0208/hour, excluding surplus credits | $15.184 for 730 hours; $2.08 for 100 hours |
| Linux x86 Fargate | $0.04048/vCPU-hour plus $0.004445/GB-hour | $1.23425 for 100 task-hours at 0.25 vCPU / 0.5 GB |

Even one continuously allocated ALB exceeds the approved additional budget
before capacity/IP charges. An illustrative 100 worker-hours plus 100 of those
Fargate task-hours costs $3.31425 in compute only. This is an incomplete estimate:
IPv4, storage/requests, secrets, builds, transfer, logs, scheduling, restart/billing
overhead and taxes are excluded. Do not treat that subtotal as a $10 guarantee.
Public prices exclude account-specific discounts. Local raw pricing responses
and reproducible Decimal results are retained in
C:\Users\aniru\.codex\verification\smartdeploy-browser-transactions-1792908765365
under `*-prices.json`, `pricing-normalized.json` and `core-cost-model.json`.

[AWS load-balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
describes hourly/capacity charging. The exact regional rates above come from
the current Price List API, rather than a default-region webpage example.
[Fargate sizing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)
permits this Linux CPU/memory combination; it is not evidence an arbitrary
customer app fits that size.

## Candidate architecture to validate

- Reuse the on-demand trusted worker for gateway processes; keep customer code
  in separate Fargate tasks. Never run untrusted applications beside platform
  credentials on the worker or put a privileged gateway in their task.
- Use a stable control-plane launch/share URL to authenticate, authorize, check
  resource reservations, wake capacity and wait for readiness before redirecting
  to the app origin. A raw dormant runtime hostname cannot itself serve a wake
  screen. Prove this startup path in browser tests before advertising the link.
- Route gateway traffic to the current task's ENI over an authenticated private
  connection. Use dedicated per-app/environment security groups whose only
  ingress is the gateway group on the declared origin port. No direct public
  load-balancer rule, broad CIDR or cross-app ingress may remain.
- Fargate image-pull/egress networking still needs a validated route. Public task
  addresses in public subnets can avoid NAT/endpoints, while ingress remains
  restricted by security groups; their IPv4 costs must be included. This is not
  permission to expose a customer's application port to the Internet.
- Bind runtime registration to app, environment, release/artifact, task identity
  and endpoint. A private IP alone is insufficient because it can be recycled
  to another workload. Require a unique verified TLS workload identity for the
  expected binding before forwarding headers, cookies or bodies. Do not share
  one wildcard private key with all apps, disable peer validation or expose
  platform/gateway credentials to customer tasks.
- Keep build roles, task execution roles and app roles separate. Scope secrets
  to the app/environment. Data quotas must be enforced by a trusted broker;
  unrestricted direct DynamoDB/S3 writes would bypass application-level quotas.

These are proposed application controls, not guarantees provided by Fargate or
security-group metadata. [Task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)
documents ENIs, public-address options and image-pull routes.
[ECS network security](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-network.html)
documents task security groups and transport encryption. Cross-app TLS identity,
direct-origin denial and restart/routing tests remain implementation gates.

## Cost and release gates

Before provisioning, price every remaining service and produce a complete
bounded-use envelope with current regional rates. Implement atomic admission
reservations for task/worker time, build time, storage, requests, concurrency and
transfer; account for startup and shutdown, retries and orphan cleanup. An AWS
budget alert alone is not enforcement. Stop new work before reservations exceed
the budget and prove idle shutdown preserves persistent data. Preserve existing
non-pilot jobs when coordinating the shared worker's lifecycle.

Keep all deployment/startup flags off until full-repository >=95, integrated
local creator/member/outsider checks, reviewed infrastructure diffs, complete
cost controls and the user's existing conditional production gate are satisfied.
No live migration, provisioning, DNS/provider change, worker start or deployment
is performed by this plan.
