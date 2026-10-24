# AWS small-software rollout

Status: implementation plan, not a claim of shipped capabilities.

## Product outcome

A creator deploys an agent-built internal tool, invites colleagues, saves data
that survives a release, publishes an update at a stable URL, and revokes a
colleague's access through SmartDeploy.

This follows YC's [A Cloud for Small Software request](https://www.ycombinator.com/rfs).
The initial audience is small teams using private internal tools, with GitHub as
the source and the existing analysis/blueprint workflow retained.

## Scope and operating boundaries

- Use AWS for new builds, application runtimes, and application data resources.
  Build on the existing SQS/Lambda, CodeBuild, ECR, ECS Fargate, and S3 paths.
- The user authorized discarding the uncommitted K3s/Oracle/GCP experiment.
  Its tracked changes were restored to HEAD and its added source/configuration
  files removed from the original checkout. Keep this rollout on AWS.
- Keep existing Better Auth and Supabase platform dependencies during the first
  increment. Moving the platform database or authentication to AWS is a separate
  migration decision; AWS application resources must not require that migration.
- Keep the existing Stripe/billing PR #85 separate. Inspect its state before
  any billing changes; do not duplicate or silently absorb its commits.
- Use focused PRs. Independent slices branch from current origin/main; dependent
  slices can use stacked branches with explicit base/merge order. Do not merge
  PRs, apply production migrations, provision billable resources, or deploy as
  part of scheduled implementation.
- Read AGENTS.md and applicable skills before each implementation. Preserve
  DeployConfig as the source of truth for a deployment. Avoid broad refactors.
- Confirmed in session 5: signing out of SmartDeploy must end all private-app
  sessions for that user, across their apps and originating platform logins.
  Implement and test this before enabling the private gateway.
- Latest manual instruction authorizes AWS WebSocket startup and production
  promotion after testing establishes confidence in the entire feature. The
  [release readiness audit](./SMALL_SOFTWARE_RELEASE_READINESS.md) records why
  that condition is not yet met. Retain this conditional authorization; do not
  mistake incomplete acceptance gates for a need to ask permission again.

## PR sequence and acceptance criteria

Each row is a review boundary, not a promise to finish one row per work session.
Split further when the implementation is too large to review safely.

| Slice | Depends on | Deliverable and acceptance criteria |
|-------|------------|-------------------------------------|
| 1. App/workspace foundation | None | Additive schema and typed domain model for workspace membership, app ownership, app configuration, and release association. Existing personal deployments remain functional. Migration/backfill is resumable and has a documented rollback boundary. Tests cover ownership and cross-workspace denial. |
| 2. Membership and invitations | 1 | Workspace roles and app-use grants are distinct from deployment/secret management rights. In-app invitation links are expiring, revocable, single-use, and bound to the verified intended identity. No automated email sending. Tests cover wrong user, replay, expiry, removal, and privilege escalation. |
| 3. Private application access | 1, 2; isolation design can start independently | Design and implement an AWS-compatible access gateway. Apps are private by default; authorization covers pages, APIs, assets, and WebSocket connections. Direct origins cannot bypass access control. Reject spoofed identity headers, isolate cookies, fail closed, and define revocation semantics for existing connections. Do not label an app private before the runtime enforces its policy. |
| 4. Application data and isolation | 1; AWS design can start independently | One supported persistent database path, file storage, per-app secrets, least-privilege build/runtime identities, quotas, and preview/published data separation. Include migration, backup/restore, retention, and deletion behavior. Test credential boundaries and cross-app access denial. Infrastructure is reviewable without applying it. Resolve material service/cost choices before provisioning. |
| 5. Preview, publish, and share | 1, 2, 3; 4 for persistent-data demo | App-centric dashboard and stable URL. Retain the blueprint in an expandable technical view. Preview, access selection, publishing, sharing, health, and restoring an earlier release are understandable without cloud concepts. Code rollback must not imply database rollback. Browser tests cover creator and invited-user flows. |
| 6. Agent tools and usage controls | 1, 3; inspect billing PR #85 | Extend existing CLI/API rather than rebuilding it. Add authenticated, app-scoped MCP operations for inspecting plans, publishing, status, and sharing. Separate read/write grants, audit changes, and prevent unauthorized publishing. Show app usage and implement enforceable resource/spend controls. Idle suspension is a separate slice if reliable wake-up cannot be verified. |
| 7. Integrated pilot verification | 1-6 | Exercise the complete outcome with creator, invited colleague, and outsider identities. Verify data survives a release; secrets/origins cannot be accessed by outsiders; access revocation works. Record local, CI, infrastructure-plan, hosted smoke, and live end-to-end evidence separately. Hosted proof requires separately authorized deployment. |

## AWS runtime design checks

Before implementing the gateway and data-resource slices, inspect current AWS
configuration and retrieve current official AWS documentation using the relevant
skills. Choose a design that supports the existing application protocols and
build plans. Do not assume that platform sign-in protects a deployed app or that
a Fargate task by itself establishes every required tenant boundary.

An access gateway must have an origin-bypass prevention design, and application
containers must receive only their own runtime credentials. Private static sites
need an authorization path too. Business-level rules inside a customer's app
remain that app's responsibility; SmartDeploy supplies verified identity.

## Validation and publication

- Add meaningful unit tests for new behavior and negative authorization cases.
- Run integration checks when deployment, gateway, persistence, or queue logic
  changes. Use browser checks for rendered product flows and multiple identities.
- Run the build and relevant checks. For React changes, follow the react-doctor
  skill and meet the repository's 95/100 requirement before claiming completion.
  Record baseline failures and fix introduced regressions; do not hide blockers.
- Keep heavy validation serial; cap Vitest workers at two when needed.
- Before publication, verify the GitHub account is anirudh-makuluri, inspect
  intended staging, run git diff --check, and inspect the final diff. Open a
  draft PR when required validation or a dependency is unresolved, with an exact
  explanation. Attach each PR to this chat and identify its base/dependencies.
- CI success and live proof are separate. No slice is complete merely because
  a PR exists, its feature flag is present, or its configuration was generated.

## Scheduled implementation window

Kickoff: October 23, 2026, approximately 01:15 America/Phoenix.
Target: six follow-up sessions, approximately two hours apart, ending around
13:15 America/Phoenix. Scheduling is best effort and depends on the local host.

At each session, inspect the working tree, prior PRs, CI, and this chat's latest
instructions. Finish or repair the active slice before expanding scope. Publish
separate reviewable PRs as they become ready, recording dependencies and checks.
Do not compress security or verification to meet the time target.

At the end of the window, report completed slices, PR links, validation evidence,
and remaining work or decisions. This is a time-boxed implementation pass; the
full production platform is not guaranteed to be finished within 10-12 hours.
Do not begin further scheduled feature work after the window without a renewed
schedule. Stay quiet when no meaningful progress or actionable change occurred;
report a published PR, completion, failure, or decision requiring user input.

## Progress ledger

| Item | Status | Evidence |
|------|--------|----------|
| Kickoff | Prepared | Clean managed worktree from origin/main; uncommitted K3s/Oracle/GCP experiment discarded at the user's request. |
| Existing billing | Separate open PR at kickoff | https://github.com/anirudh-makuluri/smart-deploy/pull/85 |
| Slice 1: ownership foundation | Open for review; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/91 — branch `feat/app-workspace-foundation`, base `main`, independent of #85 and #90. Additive schema, optional rerunnable backfill, typed policy helpers, and PostgreSQL CI job. 119 unit files / 404 tests, 8 PostgreSQL 16 integration tests, lint, production build, and diff checks passed locally; GitHub database/build/tests and React Doctor checks passed. See the latest local dependency-health baseline below before claiming overall 95/100 compliance. |
| Slice 2a: membership/invitation backend | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/92 — branch `feat/workspace-invitations`, base `feat/app-workspace-foundation`; merge #91 first. Browser APIs for team workspaces, rosters, owner-controlled role changes, removal, expiring/revocable verified-email invitations, and atomic redemption. Default-off feature flag. 120 unit files / 416 tests, 21 PostgreSQL integration tests, lint/build/diff checks passed; final focused API tests also passed after fixing three route diagnostics. React Doctor 0.9.18 versus the exact #91 base: 100/100 with zero diagnostics. GitHub database/build/tests and React Doctor checks passed on `6ecc4d3`. |
| Slice 2b: app-use policy backend | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/93 — branch `feat/app-use-grants`, base `feat/workspace-invitations`; merge #91 then #92 first. App creation/listing, ordinary-member use grants, current verified-identity lookup, membership-cascade cleanup, and explicit access-event API. 120 unit files / 422 tests, 32 PostgreSQL tests, full lint/build, staged diff check, and complete 9-file exact-base React Doctor scan (100/100) passed locally. All GitHub database/build/tests and React Doctor checks passed on `e4c8aa3`, verified in session 4. |
| Slice 3a: handoff/session storage | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/94 — branch `feat/private-app-handoff`, base `feat/app-use-grants`; merge #91 → #92 → #93 first. Server-only store/schema: hash-only credentials, S256 proof, exact operator-owned origin/app binding, atomic single-use redemption, fresh verified policy lookup, permanent invalidation on access/identity/binding changes, and explicit bounded lifetimes. 120 unit files / 422 tests, 4 PostgreSQL files / 46 tests (14 new gateway cases), lint/build/diff checks, and all three changed TypeScript files in exact-base React Doctor (100/100, zero diagnostics) passed locally. GitHub database/build/tests and React Doctor checks passed on `7060dce`. No HTTP endpoints or runtime enforcement are exposed. |
| Slice 3b: authenticated gateway API | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/95 — branch `feat/gateway-authorization-api`, base `feat/private-app-handoff`; merge #91 → #92 → #93 → #94 first. Default-off service endpoints for redemption, authorization, and per-app logout. Hash-only expiring/revocable machine keys derive the binding; clients cannot choose authority. Current approval/use checks, 4 KiB/5-second streaming body bounds, strict schemas, secure service-only request profile, redacted errors, and fail-closed responses. 121 unit files / 437 tests, 5 PostgreSQL files / 53 tests (7 new real credential/route integration cases), lint/build/diff checks, and exact-base React Doctor across all 9 TypeScript files (100/100) passed locally. GitHub database/build/tests and React Doctor checks passed on `80ce05a`. No public handoff issuance, proxy, or AWS origin enforcement. |
| Slice 3c: platform-session binding/global logout | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/96 — branch `feat/global-app-logout`, base `feat/gateway-authorization-api`; merge #91 → #92 → #93 → #94 → #95 first. Implements confirmed all-app logout for the user. Live platform-session proof, expiry caps, current session joins, atomic credential/platform-session removal before cookie clearing, and database revocation hooks. Upgrade clears only unbound legacy credentials; reruns preserve bound ones. 122 unit files / 443 tests, 6 PostgreSQL files / 63 tests (10 added integration cases), lint/final build/diff checks, and exact-base React Doctor across all 8 TypeScript files (100/100, no diagnostics/suppressions) passed locally. Real installed Better Auth schema, signed login cookies, logout, rollback, and expired-session cleanup were tested locally. GitHub database/build/tests and React Doctor checks passed on `bfb328b`. |
| Slice 3: private runtime | Control-plane storage/API/logout prepared; browser adapter and runtime pending | [AWS_PRIVATE_GATEWAY.md](./AWS_PRIVATE_GATEWAY.md) records current direct-ALB code, a separate Fargate gateway/private origin chain, identity handoff, cookie/header isolation, revocation, static-site exclusions, and operating/cost decisions. Sources: AWS, MDN, and IETF primary documentation. No origin routing or hosted access protection changed. |
| Slice 3d: platform browser handoff issuer | Draft stacked PR; CI passed, not merged | https://github.com/anirudh-makuluri/smart-deploy/pull/97 — branch `feat/browser-app-handoff`, base `feat/global-app-logout`; merge #91 -> #92 -> #93 -> #94 -> #95 -> #96 first. Default-off same-origin HTTPS POST, fresh Better Auth session/current approval, current database use policy, strict bounded input, fixed operator callback, and opaque state echo. 123 unit files / 456 tests, 7 PostgreSQL files / 69 tests, lint/build/diff checks, and exact-base React Doctor across all four changed TypeScript files (100/100) passed locally on `6383349`. Six new integration cases use real Better Auth signed cookies. GitHub database/build/tests and React Doctor checks passed on that exact head. Confirmation UI, gateway browser-transaction/state/cookie enforcement, and private runtime remain pending. |
| Remaining UI and slices 3-7 | Pending | The platform issuer is prepared in #97; the next implementation is the explicit confirmation UI, gateway browser transaction/state/cookie handling, and a local gateway/runtime fixture. Explicit production lifetimes, domain/cost choices, proxy HTTP/WS enforcement, direct-origin blocking, sharing/acceptance UI, persistent app data/resources, usage controls, and hosted end-to-end proof remain outstanding. The full deliverable is not achieved in this window. Passing metadata/policy/API tests are not private-runtime proof. |

Session 1 (October 23, approximately 03:21-03:33 America/Phoenix): implemented
the foundation in a clean branch from `origin/main`. Database checks used a
disposable local PostgreSQL 16 cluster, which was stopped afterward. The local
build exited successfully with unconfigured Better Auth secret/base-URL warnings
and a Turbopack tracing warning; it does not establish hosted authentication.
Existing runtime endpoints remain unchanged. Do not treat the new ownership
metadata or pure permission helpers as deployed application access enforcement.

Session 2 (October 23, approximately 05:18-05:43 America/Phoenix): verified #91
CI and review state, then implemented #92 as a separate stacked backend increment.
The disposable PostgreSQL test cluster was stopped after verification. No email,
production migration, cloud provisioning, merge, or runtime configuration change
was performed. CI now also runs against feature-branch PR bases so stacked
increments get database/unit/build checks.

Quality baseline: the initial #92 scan found three independent-await warnings;
all were fixed without suppressions. The final exact-base #92 scan is 100/100.
The latest local React Doctor 0.9.18 comparison against `origin/main` reports
43/100 from `socket/low-supply-chain-score`, also reproduced in an isolated,
unchanged #91 checkout. Dependencies were not changed by these increments.
This broader baseline still requires separate dependency-health triage before
claiming repository-wide health of at least 95/100. The temporary baseline
worktree was submitted for archival after the comparison.

Session 3 (October 23, approximately 07:21-07:45 America/Phoenix): verified #92
CI, implemented #93 as a separate stacked increment, and prepared the private
gateway design in planning PR #90. App-use grants require current verified
ordinary membership; owner/admin access is inherited and cannot be revoked by
pretending it is an ordinary grant. Removed/reinvited members do not regain old
grants. Per-app use never grants deployment/configuration/secret management.
The PostgreSQL fixture cluster was stopped afterward. No production migration,
email, cloud resource, runtime configuration change, or merge was performed.

Session 4 (October 23, approximately 09:22-09:45 America/Phoenix): verified #93
CI/reviews and the current stacked branch bases, then published #94 as a separate
storage increment. Code consumption/session creation is transactional; a failed
session insert rolls consumption back. Tests cover permanent invalidation even
when access is restored before the next authorization request, concurrent
redemption/revocation, exact callback binding, identity changes, SQL privilege
boundaries, and expiry cleanup. Gateway authentication, browser transaction
binding, proxy enforcement, and origin blocking are still unimplemented. The
feature documentation records the trigger caller's database-role requirements
before any migration is applied. All #94 CI checks passed. App sessions are
independent records; the integration must also define/test propagation of
platform logout/account-security revocation before production enablement.
Build passed with local dummy Better Auth
values and the unchanged Turbopack tracing warning. The local PostgreSQL cluster
was stopped. Billing #85 remains open/separate; the original checkout is clean.
No production migration, email, provisioning, runtime deployment, connection
change, or merge was performed. There are two scheduled follow-up slots before
the bounded deadline; do not compress the remaining security work to fit them.

Session 5, first increment (October 23, starting 11:20 America/Phoenix): verified
#94 checks/reviews and published #95. Real route handlers, credential lookup,
and session storage were exercised together against PostgreSQL for creator and
member flows, outsider denial, logout, and user/key revocation. These are handler
Request/Response tests, not browser/network TLS or origin-blocking proof. The
disposable database was stopped. Billing #85 remains open/separate; the original
checkout remains clean. The user chose global app logout on platform sign-out.
Inspection of installed Better Auth 1.6.23 found sign-out catches database
deletion errors and can return success anyway; the next increment must verify
revocation before reporting success, including stale handoff/concurrency cases.

Session 5, second increment (October 23, approximately 11:47-12:25 America/Phoenix):
after #95 CI passed, implemented and published #96 for the user's confirmed
global app-logout policy. The real-library test reproduces Better Auth's swallowed
deletion error; the guarded route performs revocation transactionally before
cookie clearing. Other active SmartDeploy logins remain signed in but their app
credentials are removed. Expired-login cleanup does not revoke unrelated active
logins' apps. Concurrent issuance/redemption cannot survive deletion of its
originating platform session. The initial Doctor scan flagged independent awaits;
the ordered platform-session/identity check was grouped into one authorization
helper without changing lock order or suppressing diagnostics. The full database
suite and final build were rerun afterward; the final scan is 100/100. The
database cluster was stopped. No production migration, provisioning, provider
connection change, email, merge, or application-runtime deployment was performed.
All #95 and #96 CI checks passed at their published heads.
The runtime, private network, persistence, UI, and agent-tool slices require
further implementation; they have not been completed or enabled by these PRs.

Final window audit (October 23, 23:45 UTC / 16:45 America/Phoenix): the bounded
implementation window has ended. No new implementation was started during this
audit. GitHub confirms #90-#96 remain open at the recorded heads with all reported
checks passing; #92-#96 remain drafts. Required implementation merge order is
#91 -> #92 -> #93 -> #94 -> #95 -> #96. Billing #85 remains separate and open.
Both the original checkout and this managed worktree were clean before this
documentation update. The scheduled automation was deleted after its deadline.
The remaining runtime, isolation, persistence, UI, agent tooling, usage controls,
and integrated verification work requires a new implementation pass. Existing
application URLs have not gained private access enforcement from these PRs.
The full agreed deliverable remains incomplete; no production migration, cloud
provisioning, merge, or production deployment was performed in this rollout.

Manual continuation (October 23, after the user's renewed "continue" request):
resumed implementation without restarting the expired automation. Verified #96
CI and its exact head, billing #85's separate open state, and both clean checkouts.
Published #97 as the next independent review boundary stacked on #96. Its issuer
does not mint from GET/navigation, accept caller identity/callback authority, or
trust a cached platform cookie. Current database permission and platform-session
proof remain mandatory; state echo does not prove a gateway browser transaction.
Added 13 unit tests and six signed-cookie/PostgreSQL cases. The disposable local
database was stopped. Both feature flags remain default-off. No production
migration, provisioning, invitation email, provider connection change, merge,
or production deployment was performed. GitHub database/build/tests and React
Doctor checks passed on the published `6383349` head; the automatic Vercel preview
also passed. These checks do not prove a protected application runtime. Current
implementation merge order is #91 -> #92 -> #93 -> #94 -> #95 -> #96 -> #97.

Production-readiness continuation (October 23, at the user's request): rechecked
live PR/CI state and the exact combined implementation head, compiled the worker,
passed 26 additional WebSocket unit tests and all six existing Chromium browser
tests. A full 559-file Doctor scan reports 49/100, below the required 95; this is
the current whole-repository result, distinct from earlier snapshots and per-PR
scores. Production dependency audit reports 38 entries including two critical.
Read-only AWS CLI inspection found the configured production worker stopped;
its HTTPS health probe timed out. The full private runtime, origin blocking,
browser flow, product/data/tooling slices, and integrated proof remain incomplete.
The user's conditional production gate is not satisfied, so no instance was
started, PR merged, feature enabled, production migration applied, or release
dispatched. See [the audit](./SMALL_SOFTWARE_RELEASE_READINESS.md) for exact
evidence, diagnostic triage, boundaries, and required remaining work.

Remediation continuation (October 23, renewed user authorization): published
draft [#98](https://github.com/anirudh-makuluri/smart-deploy/pull/98), head
`eae46593a65b2295c91868d8f11ff374bf20ac14`, stacked on #97 at `6383349`.
Updated Next.js/Better Auth/Undici/Zod and compatible transitive dependencies;
both full and production-only npm audits now report zero vulnerabilities. Zod
strict input boundaries and normalization are preserved. New framework checking
exposed incomplete test fixtures, repaired without removing assertions; CI now
also runs full typechecking and worker compilation. Verification: 123 unit files /
457 tests; seven PostgreSQL files / 69 tests; full typecheck; worker compilation;
production build; six Chromium public-page tests; clean diff check. Full pinned
Doctor 0.9.18 increased from 49/100 (49 findings) to 72/100 (47 findings), still
below the required 95. Exact changed-file scan: 15 TypeScript files, 100/100,
zero findings. Lint reports an existing recovery-navigation warning; dynamic
repository tracing warnings remain in the build. CI is running on the new head.
[Tracking issue #99](https://github.com/anirudh-makuluri/smart-deploy/issues/99)
records owned remediation PRs; the manifest and validation details are in #98.

The user approved the existing `smart-deploy.xyz` domain and an additional AWS
budget of at most $10/month. Read-only AWS inspection found no RDS instance and
only that hosted zone. AWS Price List quotes the existing Oregon t3.small worker
at $0.0208/hour: 730 hours would cost $15.18 in compute alone. The user therefore
accepted an on-demand pilot with idle shutdown and a startup delay. Do not start
an always-on worker or add always-on ALB/RDS infrastructure under this budget.
Prepare explicit resource/usage limits, startup/idle watchdogs, and conservative
reservations before paid work. Shared-parent-domain app hosting additionally
requires host-only platform cookies and sibling-origin isolation tests. These
decisions supersede any earlier always-on/separate-domain assumptions, while
retaining Better Auth/Supabase platform dependencies. Production deployment is
conditionally authorized only after the entire feature is verified; that gate
has not been met. No production change or billable resource was made. The local
database and browser servers are stopped. The expired automation remains deleted.

Client recovery increment: published draft
[#100](https://github.com/anirudh-makuluri/smart-deploy/pull/100), head
`fba977935dd5486b9d9deb40e7956193e7077e85`, stacked on #98. Both header logout
and automatic broken-session recovery now check the SDK's error result, retain
the page/session on failure, and permit retry. Worker sockets follow the current
user ID, have connection-local token caches, reset displayed state on account
changes, and remove exact listeners on teardown. The old cleanup scanner match
was a false positive: the prior effect already disconnected. The account-switch
and sign-out behavior changes address separately confirmed defects.

Local verification: 125 unit files / 470 tests, followed by all 21 final focused
logout/socket cases (including a newly added delayed-token case); seven database
files / 69 tests; two Chromium real-client/Next.js/PostgreSQL scenarios proving
failed DB revocation retains login and retry removes the actual session; full
typecheck; lint; production build; clean diff checks. Browser overview/cloud
health and the deliberately broken session response are stubbed; sign-out and
revocation are real. CI now runs these database-backed browser checks. The
shared fixture changed only to an explicit ESM extension with updated imports;
the database suite passed afterward. Both local servers were stopped.

Full pinned unfiltered Doctor now reports 81/100, zero errors and 46 warnings;
the exact 17-file increment reports 100/100 and no diagnostics. No suppression
or threshold change. The navigation lint warning is resolved; dynamic tracing
warnings remain. All #98 CI/preview checks passed at its recorded head. #100 CI
is running; both PRs remain drafts while repository health and full feature
acceptance are unfinished. Merge order extends #91 -> ... -> #98 -> #100.
No production enablement, migration, billable resource, worker start, merge, or
deployment occurred. The next independent review covers HTTP credential/status
boundaries before remaining UI/runtime/data/tooling work.
