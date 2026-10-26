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

Independent production-branch security candidate: published draft
[#101](https://github.com/anirudh-makuluri/smart-deploy/pull/101), head
`54fb8cdc491eee253516a3a8d19b6c3bc5f49ef2`, directly against `main` at
`d02d6fc52024b658268ff9b22b79bc5df4d361f1`. Source inspection found platform
cookies/private headers copied to analytics and upstream cookie/site-data
headers relayed back. The latest GitHub-recorded production revision contains
that code; a fresh unauthenticated public-page probe confirms use of `/ph/`.
No real account credential was used in the probe. Provider logs/historical
credential retention were not inspected. This is an active routing risk, not
proof of third-party account access.

The hotfix has only analytics header filtering, regression coverage, and a
worker auto-deploy opt-in guard so a web-only main merge cannot implicitly start
AWS resources. It does not absorb the rollout, dependency upgrades, or billing.
Local production-lockfile verification: original handler fails four of seven
regressions; patched handler passes all seven; one actual Chromium/Next/local
upstream scenario; lint; builds before/after; workflow YAML parsing. A read-only
check of the configured production DB found expected session columns and zero
active logins; nothing was mutated. The standalone main baseline remains Doctor
49/100 (3 errors/46 warnings); exact four-file scan is 91/100 with an existing
passthrough-status detector mismatch, including a staged-hook warning. These
results are retained without suppression; neither meets 95. Early deployment
needs an explicit exception to the user's full-feature gate and health rule.
CI is running. No merge, deploy, AWS start, provider change, or session expiry
was performed. Its cutover plan is in `docs/internal/ANALYTICS_PROXY_SECURITY.md`.

Use #101 before any eventual production rollout. #98 and #100 now have all
GitHub CI/preview checks passing at their recorded heads, including the two
actual browser/database logout cases in #100. Full feature acceptance remains
unfinished. The temporary duplicate proxy scaffolding in the rollout worktree
was removed only after verifying its source/test hashes match the independently
committed hotfix; subsequent HTTP-response work remains separate.

Approved security cutover: the user explicitly authorized early deployment of
#101 and expiry of any pre-fix logins, including its stated health exception.
#101 merged as `a8af9f3d42e9248c1568be9e9a537837975537b9`; Vercel production
succeeded. The live `/ph/e` OPTIONS response changed from allowing authorization
to the new credential-free header set (204, no Allow-Credentials), and API health
returns 200. AWS workflow
[40069213272](https://github.com/anirudh-makuluri/smart-deploy/actions/runs/40069213272)
and its deploy job were skipped; EC2 remains stopped. After verifying the fixed
handler, the transaction at `2026-10-24T06:15:03.084Z` found zero active pre-fix
sessions, deleted zero rows, and rolled back. No user/provider account changed.
The exception applies only to #101, not the remaining rollout or AWS startup.
Its managed worktree was submitted for recoverable archival after release.

The rollout branches were rebased onto that release to inherit credential
filtering and the worker deployment guard. Original local heads are retained
under `refs/codex/rollout-before-hotfix/`; remote heads were checked and all nine
updates pushed atomically with exact force-with-lease protection. No unrelated
branch or billing PR changed. Current heads:

| PR | Head |
|----|------|
| #91 | `b68513c975b55d407a8687b7e3b9a961cb6ce907` |
| #92 | `10f846426e0446212e6dbec779005b2b90fcd567` |
| #93 | `14b2d8178e2aa9d2ca75ca6cba8c8e3e6e21bdc2` |
| #94 | `56af73dff6294ad4bedf6e4cb1b1f6d0a3d33a2d` |
| #95 | `4b493a79c5fafd605e9d8319e01e8016497747eb` |
| #96 | `2b70d9eed5fae156668258b0557076b8ac1f9f09` |
| #97 | `b9ec51e242ce745737ffac784aefb1bae85c6742` |
| #98 | `1f6a299c2c8d764cdaf47aed321584c72c09ff24` |
| #100 | `e8e87ad7ef3c73febf807d3f9d7bfa79314661a4` |

Combined verification after rebase: 126 unit files / 478 tests; seven PostgreSQL
files / 69 tests; both real client/server/database logout browser cases; the
real analytics browser/network case; full typecheck; worker compilation; lint;
production build; full dependency audit with zero vulnerabilities. The only
source conflict combined both browser fixtures' fresh-server requirements.
The local database/browser servers are stopped. Fresh CI is running at the new
published heads; do not carry old green receipts forward. Full Doctor is 73/100
for the refreshed dependency parent and 81/100 (zero errors/46 warnings) for the
combined recovery candidate; the exact 17-file recovery diff is 100/100. Both
dependency/recovery manifests preserve historical snapshots and record current
bases and rebase evidence. The wider 95/100 and complete-feature gates remain.
The user selected DynamoDB documents and S3 files for deployed-app data within
the additional $10/month on-demand pilot budget. Existing platform Better Auth
and Supabase dependencies remain. The user also approved verified invited-user
access to only their granted private apps before general waiting-list approval;
deployment and workspace management retain their existing approval/permission
requirements. This needs consistent invitation, browser handoff, gateway, and
session handling; the current implementation does not yet implement that
exception. No paid resource or approval-list mutation follows from these choices.

HTTP response increment: published draft
[#102](https://github.com/anirudh-makuluri/smart-deploy/pull/102), head
`3979eac6ad7d19e9f675463289ecc91ba9072616`, stacked on #100 at `e8e87ad`.
Denied/malformed/truncated GitHub trees and failed important-file downloads now
stop analysis before model invocation. Important files use the selected branch.
GraphQL, analysis-save, and GitHub installation-token clients validate status and
success envelopes. No malformed 200 is treated as a saved analysis. No immutable
snapshot, inspection quota, or narrower build credential is claimed by this PR.

Verification: 129 unit files / 501 tests, full typecheck, lint, worker compilation,
production build, and diff checks pass locally. A route/helper integration feeds
a GitHub 403 and verifies no model invocation. All upstream responses are test
doubles. The first full-unit attempt was stopped when Windows npm dropped the
worker-limit argument; the successful run used direct Vitest with two workers.
Build retains existing dynamic tracing and local missing-auth-config warnings.
Pinned Doctor 0.9.18 exact eight-file scan is complete at 100/100 with no findings;
the complete unfiltered 570-file scan improves from 81 to 82/100 (zero errors,
42 warnings). The repository 95/100 and complete-feature production gates remain.
CI is running for #102. Refreshed #98 and #100 CI/preview checks now all pass at
the rebased heads above. No rollout merge, production migration, cloud resource,
worker start, invitation email, or provider-connection change was performed.
Merge order extends #91 -> ... -> #98 -> #100 -> #102. The expired automation
remains deleted; manual implementation continues under the user's instruction.

Invited-app admission: published draft
[#103](https://github.com/anirudh-makuluri/smart-deploy/pull/103), head
`1024ac803dd9cb9a9ed7ac7e6288493605e1eab7`, stacked on #102 at `3979eac`.
Implements the approved ordinary-member invitation/app-use exception before
general waiting-list approval. Requires accepted invitation provenance, current
verified email/membership, and an explicit grant for that exact app; inherited
management access is insufficient. Administrator invitations stay unconsumed
until platform approval. Handoff and gateway decisions share this boundary.
Retained app-only logins cannot unlock legacy platform APIs: the explicit Next
API matcher enforces current browser/CLI approval and rejects sibling origins.
Disabling the pilot does not turn retained logins into platform privileges.

Local verification: 130 unit files / 530 tests, seven PostgreSQL files / 72 tests,
two actual Chromium/Next/Better Auth/database invitee and approval-revocation
scenarios, both existing logout-recovery browser scenarios, full typecheck,
lint, worker compilation, production build, YAML parsing and diff checks pass.
The browser approval HTTP backend is a local fake; verification uses a local
SQL fixture. Schema preparation now finishes before Next starts; browser hooks
no longer race Better Auth schema introspection. The bootstrap refuses nonlocal
or non-test database URLs. All local servers are stopped. Complete pinned
18-file Doctor: 100/100; complete unfiltered 575-file scan: 82/100, zero errors /
42 warnings, unchanged. No suppression. #102 CI/preview checks all pass at its
recorded head. #103 CI is running. Merge order extends #91 -> ... -> #102 -> #103.
Full 95/100, runtime, data, UI, tooling and integrated hosted gates remain.

The user subsequently required verified email for platform deployment and
management too, in addition to applicable waiting-list approval. This resolves
the question left open in #103's snapshot. Implement the stricter platform
identity boundary as a separate increment, including browser, CLI and worker
entrypoints and revocation checks. Unverified accounts must use verified OAuth
or a verification flow before management. No production migration, resource,
worker start, invitation email, provider connection change, merge or deployment
was performed. The original checkout remains clean and untouched; implementation
continues in this chat's managed worktree.

Verified platform authority: published draft
[#104](https://github.com/anirudh-makuluri/smart-deploy/pull/104), head
`3371285b930ee47906210d0960041699707c260b`, stacked on #103 at `1024ac8`.
Implements the user's verified-email requirement independently of the waiting
list and pilot flags. Fresh browser identities, workspace management, existing
CLI tokens, device approval/redemption, and worker credential issuance enforce
current verified authority and applicable approval. Failed CLI redemption rolls
back without issuing a token. Worker credential v2 is audience/session-bound
with a purpose-derived HMAC key; no auth-secret rotation or legacy fallback.
Connections require an explicit Origin allowlist and current platform session.
Packets reauthorize; idle checks run every 30s with a 5s deadline and teardown.
Release the API issuer and worker together, with valid DB/auth/approval config.

Verification: 134 unit files / 563 tests, eight PostgreSQL files / 79 tests,
both actual verification/invitee browser cases, both logout-recovery browser
cases, full typecheck, lint, worker compilation, production build and diff
checks pass. Real loopback WebSocket/database tests prove denied packets never
reach handlers, revoked sessions cannot connect, sibling Origins are rejected,
and CLI consumption rolls back after verification loss. Approval uses test
doubles/local HTTP fixtures; this is not hosted or real email/OAuth proof.
Complete pinned Doctor: 22 changed source files at 100/100, zero findings;
unfiltered 582-file repository scan remains 82/100 (zero errors / 42 warnings).
No suppression. Build tracing warnings remain. All local servers are stopped.

Read-only production catalog checks confirmed client roles have no core auth
table privileges and no login/superuser/RLS bypass. CLI tables have RLS enabled
and no policies; their broader ACLs were not changed. No production rows or
permissions were read/modified beyond catalog metadata; transactions rolled
back. No provider connection, invitation email, resource provisioning, migration,
worker start, merge or deployment. #103 CI/preview checks all pass at its exact
recorded head; #104 CI is running. Merge order extends #91 -> ... -> #103 -> #104.
Full >=95 and the remaining cookie/gateway/runtime/data/UI/tools/integrated
gates remain. Continue with host-only platform cookies for the approved shared
parent domain; do not enable untrusted sibling hosting before that boundary.

Host-only platform cookies: published draft
[#105](https://github.com/anirudh-makuluri/smart-deploy/pull/105), head
`6a090c957ae7ca5ad65b7f0d7850052fd6eb9fcf`, stacked on #104 at `3371285`.
HTTPS authentication now uses __Host-smartdeploy cookies with Secure, HttpOnly,
root path and no Domain, including dynamic OAuth state. The proxy detects and
expires the same SDK-defined cookies. Explicit HTTP loopback development keeps
its ordinary local cookie names. There is no legacy cookie fallback; cutover
requires fresh login and retrying in-flight OAuth. No secret/provider changes.

Verification: 135 unit files / 575 tests, five actual browser scenarios, full
typecheck/lint, worker compilation, configured production build, YAML/manifest
parsing and diff checks pass. The new native HTTPS Chromium/Better Auth/local
PostgreSQL fixture demonstrates the prior parent-domain signed-cookie attack,
rejects legacy fallback and sibling overwrite, verifies cookie non-forwarding
to the sibling, and checks sign-out. Both existing invitee/verification and both
logout-recovery cases pass too. Verification uses SQL fixtures, not real email
or OAuth. All local servers are stopped; generated TLS fixture files removed.
The first combined browser command was rejected by automatic approval review
without a specific reason; explicit startup/test/cleanup commands succeeded.
Pinned Doctor completes seven changed source/test files at 100/100; complete
unfiltered 586-file scan remains 82/100 (zero errors / 42 warnings), with no
suppression. Existing dynamic build tracing warnings remain.

#104 CI/preview checks all pass at its recorded head; #105 CI is running. Merge
order extends #91 -> ... -> #103 -> #104 -> #105. Billing #85 remains open at
`14c67e452be54c6639ac2a7f3a69737b269c1999`, unchanged and separate. No production
migration, cloud provisioning, invitation email, provider change, worker start,
merge or deployment. Full >=95 and gateway/runtime/data/UI/tools/integrated
gates remain. Next address confirmed UI row identity, immutable editing and
keyboard/accessibility defects while continuing the full feature rollout.

Environment editor: published draft
[#106](https://github.com/anirudh-makuluri/smart-deploy/pull/106), head
`fa41862806c9394e0a074430ee5e3a8a1ab17ae4`, stacked on #105 at `6a090c9`.
Implemented in a separate managed worktree/branch. Stable row identities now
survive additions, deletions, external reorder and named imports; edits create
new objects instead of mutating caller data. Accessible names cover row inputs
and delete controls without secret values. Reveal state follows the row and
clears on deletion/closing/deployment switch. Delayed imports merge current
edits; superseded/unmounted FileReaders are aborted and cannot commit.

Verification: 136 unit files / 587 tests, including eleven real editor DOM
regressions and both actual ConfigTabs composition tests, full typecheck/lint,
worker compilation, configured production build and diff checks pass. Initial
regressions failed before implementation; deployment-switch reset omission and
a real-focus close/reopen plain-text secret were separately reproduced and
fixed. Data fetching in the composition test is mocked; this is DOM evidence,
not a native/hosted editor audit. The final closing regression justified another
complete test/build/scan pass. Existing dynamic tracing warnings remain.
Canonical index-rule guidance had version drift, and the icon prompt returned
404; pinned local rule explanations and observed failures established fixes.

Complete pinned Doctor: five changed source/test files 100/100; unfiltered
588-file combined rollout improves 82 -> 83/100, zero errors, 42 -> 40 warnings.
No suppression. Both targeted editor findings are removed. The full >=95 gate
remains. #105 all CI/preview checks pass at its recorded head; #106 CI is running.
Merge order extends #91 -> ... -> #104 -> #105 -> #106. Refreshed production main
remains released #101 at `a8af9f3`; the original D:\own\smart-deploy checkout is
still clean. All local servers are stopped. No production migration, billable
resource, provider change, invitation email, worker start, merge or deployment.
Continue remaining service-card keyboard/interaction defects and the separate
gateway/runtime/data/UI/tools/integrated acceptance gates. No new user decision
is pending.

Service-card interaction and maintainability: published draft
[#107](https://github.com/anirudh-makuluri/smart-deploy/pull/107), head
`b380f11a17893886fa044685e19993476250d76b`, stacked on #106 at `fa41862`.
Implemented in a separate managed worktree/branch. Native workspace button and
live deployment link are siblings; visible service/path/status label the button.
The card surface retains pointer activation and links open independently with
no opener. Typed status presentation preserves all six states. A separate
catalog header preserves refresh/add/busy behavior and removes the list's
measured complexity-17 warning. No backend/resource contract changed.

Final verification: 136 unit files / 600 tests, all 15 service-list tests,
typecheck/lint, worker compilation, configured production build and diff checks
pass. Chromium uses actual components, production CSS and the exact parent
source with synthetic data/callbacks and a public-only browser shim. Desktop
dark, narrow light and narrow RTL cases pass keyboard/focus, text/padding/link
hit-tests, new-tab/no-opener isolation, URL truncation, overflow and outside
overlay precedence. All normal-state comparisons have zero changed pixels;
focus states were inspected. This is isolated component proof, not hosted/auth
or AWS end-to-end evidence. The first candidate's unnecessary link z-index
failed overlay hit-testing and was removed before publication.

One full-unit attempt failed to load seven suites with ENOENT after global
Temp transform files vanished; 129 suites / 587 executed tests had passed.
Older evidence directories also disappeared, for unknown reasons. No test was
suppressed. A private child-process TEMP/TMP rerun passed all 598 tests, followed
by all 600 after header coverage. New evidence is retained outside global Temp
at C:\Users\aniru\.codex\verification\smartdeploy-service-card-1792890473933.
The clean #106 parent scan was regenerated after the evidence loss.

Complete pinned Doctor: three changed source/test files 100/100; unfiltered
589-file rollout remains 83/100 while warnings drop 40 -> 38 (zero errors,
28 -> 27 affected files). Both targeted warnings are removed without suppression.
#106 CI/preview checks all pass at its exact recorded head; #107 CI is running.
Merge order extends #91 -> ... -> #105 -> #106 -> #107. All local fixture servers
are stopped. Production main remains released #101 at `a8af9f3`; no rollout
merge, production migration, resource provisioning, invitation email, provider
change or worker start occurred. Full >=95 and gateway/runtime/data/UI/tools/
integrated gates remain unmet.

A material preview-access question is pending: whether app-use colleagues may
open unpublished previews or only published apps. Recommended published-only,
with previews limited to workspace owners/admins. Do not assume an answer for
preview session/data authorization; continue independent work meanwhile.

Report confirmation: published draft
[#108](https://github.com/anirudh-makuluri/smart-deploy/pull/108), head
`da99bf246ab9a0b071dbd6b94b29d13e635390cd`, stacked on #107 at `b380f11`.
An HTML or malformed successful response previously claimed report success and
discarded the draft. The client now requires the existing ok:true/UUID receipt;
otherwise it retains the draft and restores explicit retry. HTTP failures were
already rejected. No route/schema contract changed; ambiguous retry can still
create a duplicate report because no idempotency protocol is introduced.

All 137 unit files / 614 tests pass, including fourteen focused regressions
(ten failed against the exact parent). Typecheck/lint/worker/configured build
and diff checks pass. Actual-component Chromium with production CSS and a
synthetic loopback endpoint reproduces parent data loss, then verifies candidate
HTML/false acknowledgements retain identical retry payloads and only a valid
receipt closes/resets. The retained-draft image was inspected. This is isolated
browser/transport proof, not hosted/authenticated/Supabase/AWS end-to-end proof.
Local fixture servers are stopped. Evidence is retained outside global Temp at
C:\Users\aniru\.codex\verification\smartdeploy-report-response-1792893117311.

Complete pinned Doctor: both changed source/test files 100/100; unfiltered
590-file rollout remains 83/100 with zero errors, 38 -> 37 warnings and 27 -> 26
affected files, without suppression. #107 all CI/preview checks pass at its
recorded head; #108 all CI/preview checks pass at `da99bf2`. Merge order extends #107 -> #108.
Full >=95 and gateway/runtime/data/UI/tools/integrated gates remain unmet.
Preview audience remains a pending user decision. No production migration,
resource provisioning, provider change, invitation email, worker start, rollout
merge or deployment occurred.

Invitation inspection: published draft
[#109](https://github.com/anirudh-makuluri/smart-deploy/pull/109), head
`a94f60266c4f57c2cf2d93710af0decd9311b3d8`, stacked on #108 at `da99bf2`.
Backend support for an informed confirmation screen: bounded same-origin HTTPS
POST returns only workspace name/ID, invited role and expiry to the intended
current verified account. It never joins, grants app use or consumes the token.
Inspection and acceptance share current validation; acceptance rechecks and
retains its atomic single-use update. Member-only waiting-list policy and
separate management protections remain. No preview-audience policy is inferred.

Final local checks pass: 137 unit files / 621 tests, both focused API suites
(54 tests), eight PostgreSQL files / 88 tests, typecheck/lint/worker/configured
production build/diff checks. Nine new database cases include three actual route
cases with installed Better Auth signed cookies. Approval service responses
are mocked and verified identities use SQL fixtures; this is not rendered
browser, real email/OAuth or hosted/AWS proof. An initial moved workspace-ID
reference introduced 48 database acceptance failures; fixed before publication
and the entire unchanged database suite rerun successfully. No suppression.
Evidence: C:\Users\aniru\.codex\verification\smartdeploy-invitation-inspection-1792894689410.
The disposable local PostgreSQL server is stopped.

Complete pinned Doctor: eight changed source/test files 100/100; unfiltered
591-file rollout remains 83/100, zero errors / 37 warnings across 26 files.
The baseline reuses #108's verified final source snapshot scanned before its
commit; scanner sourceRevision reflects the then-HEAD b380f11, with contents
now committed as da99bf2. #108 all CI/preview checks pass at da99bf2; #109 all
CI/preview checks pass at a94f602. CI run 40154785954 includes unit/build/type/
worker checks and database/browser regressions; proxy-browser run 40154785956
and Doctor run 40154785944 pass too. These existing browser checks do not prove
the missing invitation UI or private runtime. Merge order extends #108 -> #109. Confirmation UI, credential-safe
invitation-link/login transport, full >=95 and gateway/runtime/data/UI/tools/
integrated gates remain. Preview audience remains a pending user decision.
No migration, feature enablement, production mutation, provider change,
invitation email, cloud resource, worker start, rollout merge or deployment.

Preview-audience decision resolved: the user selected published-app access only
for colleagues with app-use grants. Previews are reserved for workspace owners/
admins, retaining current verification and platform-approval requirements.
Earlier pending-question snapshots are superseded. A focused binding/policy
increment is underway; this decision alone establishes no runtime protection or
persistent-data separation. No other product decision is currently pending.

Published/preview policy: draft
[#110](https://github.com/anirudh-makuluri/smart-deploy/pull/110), head
`1817fcca12aaffb84ff5b76ad8c1b190e4ea036b`, on #109 / `a94f602`.
Operator-owned binding classification defaults to preview. Ordinary app-use
grants admit only published bindings; verified/approved owners/admins can use
previews. Issue, redeem, authorize and invited-member waiting-list checks all
enforce the current classification. Request-body overrides and same-app
environment crossover fail. Classification changes permanently invalidate
pending codes/sessions. The migration expires pre-boundary app credentials once,
preserves platform logins and reruns, and requires older issuers to be quiesced
and actual published origins explicitly classified. No migration was applied
outside the disposable local database.

Local checks pass: 137 unit files / 623 tests; eight PostgreSQL files / 100 tests
(12 new); full typecheck/lint, worker/configured production build and diff checks.
Seven regressions fail against exact parent store/identity modules with the new
migration fixtures. Actual signed-cookie and machine-credential routes are
tested with mocked approval and SQL-verified local identities; no rendered UI or
hosted/private-origin claim. Upgrade/rerun, privileges, demotion, stale tokens
and reclassification races are covered. Disposable PostgreSQL is stopped.
Evidence: C:\Users\aniru\.codex\verification\smartdeploy-published-preview-1792906092745.
Pinned Doctor: complete ten-file scope 100/100; unfiltered 591-file rollout
remains 83/100, zero errors / 37 warnings across 26 files. No suppression.
#109 all CI/preview checks pass at its recorded head; #110 all CI/preview checks
pass at `1817fcca12aaffb84ff5b76ad8c1b190e4ea036b`.
Merge order extends #109 -> #110. Full >=95 and gateway/runtime/data/secrets/
UI/tools/usage/integrated gates remain. No production mutation, feature
enablement, provider change, invitation email, billable resource, worker start,
rollout merge or deployment. Next implement browser transaction/state/cookie
adapter. No product question is pending.

Browser transaction primitive: draft
[#111](https://github.com/anirudh-makuluri/smart-deploy/pull/111), head
`b834c1b19b65e5a75f402aabf8167c948874ac67`, on #110 / `1817fcc`.
Server-private PKCE verifier and hashed nonce/state bind a single-use claim to
the initiating browser and configured binding. Expiry/capacity are explicit and
bounded; protected host-only cookies are generated fresh. Wrong-browser/state/
binding requests cannot burn a valid flow. The latest pending attempt on a host
wins after nonce rotation; earlier tabs restart. This ephemeral single-process
map is not distributed session storage or public rate limiting.

Local checks pass: 138 unit files / 659 tests, 36 focused cases, six native
Chromium HTTPS cases, typecheck/lint/worker/configured production build/diff.
Browser cases cover swaps, simultaneous callbacks, JavaScript pre-seeding,
sibling injection/non-forwarding, tabs, capacity and expiry. The synthetic
claiming fixture has no real identity, control-plane redemption, consent UI,
customer upstream or AWS resources. Servers close and generated TLS files are
removed. Unchanged database/policy code retains #110's 100 PostgreSQL tests and
passing CI; not repeated locally here. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-browser-transactions-1792908765365.
Pinned Doctor completes four changed source/test/config files at 100/100;
unfiltered 594-file rollout remains 83, zero errors / 37 warnings, without
suppression. #110 all CI/preview checks pass at 1817fcc; #111 all CI/preview checks
pass at b834c1b, including the expanded native cookie job. Merge order
extends #110 -> #111. Remaining work: confirmation/callback/redemption/session
cookie integration, HTTP/WS/origin isolation, AWS data/secrets, publishing UI,
tools/usage, full >=95 and integrated acceptance. No production mutation,
migration, feature enablement, provider change, invitation email, billable
resource, worker start, merge or deployment. No product question is pending.

Browser authentication adapter: draft
[#112](https://github.com/anirudh-makuluri/smart-deploy/pull/112), head
`6636bb72f58f445dce88fb4bf7e9fcb752fbaf81`, on #111 / `b834c1b`.
Browser-bound S256 redemption creates a separate protected app-session cookie
only after validated success; later requests freshly authorize. Mandatory
X-SmartDeploy-Binding-Id matches the credential-selected binding before body
reading, preventing valid other-tenant credentials from authorizing the
configured app. This API/client protocol change needs coordinated release
with flags off and has no legacy fallback. Ordinary traffic still needs an
authenticated proxy; this adapter adds no listener or customer forwarding.

Local verification passes: 140 unit files / 705 tests, eight PostgreSQL files /
101 tests, 63 final focused cases, ten native HTTPS browser cases (four new
adapter and six existing transaction cases), typecheck/lint/worker/configured
production build/diff checks. The exact parent fails the binding regression
(200 versus expected 403). A test-fixture type inference error was corrected.
Native transport validates its generated CA, but control-plane identity/approval
is synthetic: no real OAuth/SQL browser flow, customer upstream or hosted/AWS
claim. Database and fixture servers stopped, generated certificates removed.
Evidence: C:\Users\aniru\.codex\verification\smartdeploy-browser-auth-1792911349747.
Complete pinned eleven-file Doctor 100; unfiltered 600-file scan remains 83,
zero errors and the same 37 diagnostics across 26 files. #111 all CI/preview
checks pass at b834c1b; #112 checks running. Merge order extends #111 -> #112.
Full >=95, real confirmation UI, HTTP/WS/direct-origin isolation, AWS data/
secrets/usage, publishing UI/tools and integrated acceptance remain. No
production migration, feature enablement, provider change, invitation email,
resource provisioning, worker start, merge or deployment. No product question
is pending. Continue confirmation-page integration.

App confirmation: draft
[#113](https://github.com/anirudh-makuluri/smart-deploy/pull/113), head
`84c63f24d394ff8f7a0f6913a471be24f154d7c4`, on #112 / `6636bb7`.
Current authorized metadata is read without issuing/joining; explicit Continue
confirms the displayed identity. Required expectedIdentity equality is checked
against fresh Better Auth and the locked current database row. Changed IDs/
emails return 409, missing assertions 400. Coordinate browser/issuer release
with flags off and no fallback. The page excludes unrelated management worker/
session-recovery providers, prohibits framing/cache/referrers, disables approval
until hydrated, validates the exact receipt and cancels stale requests.

Local checks pass: 145 unit files / 761 tests (56 new); eight PostgreSQL files /
107 tests (six new); ten compiled Next HTTPS browser cases; typecheck/lint/worker
compilation/production build/diff. Native proof composes real installed Better
Auth signed cookies, SQL policy, issuance/service-key/S256/cookies and global
logout across published/preview sessions. Approval and app content are fixtures;
verification is SQL-established. No real GitHub OAuth/email, customer upstream,
hosted or AWS claim. Desktop/mobile screenshots reviewed, no horizontal overflow.
Two pre-fix regressions fail, then all 24 affected-suite tests pass. Earlier
fixture module/source-map, standard-port, development-reload and hidden-alert
problems were corrected without relaxing origin/CSRF/database constraints.
Evidence: C:\Users\aniru\.codex\verification\smartdeploy-login-confirmation-1792913956273.
Complete pinned 22-file Doctor 100; unfiltered 614-file report 84 (prior 83),
zero errors and the same 37 warning IDs across 26 files. Full >=95 still unmet.
All fixture ports/certificates cleaned, disposable database stopped. #112 all
CI/preview checks pass at 6636bb7; #113 CI running. Merge order extends
#112 -> #113. Next private HTTP/WS proxy, upstream and direct-origin isolation,
AWS data/secrets/quotas/on-demand controls, publishing/share/invitation UI,
app-scoped tools/usage and hosted acceptance. No production migration, flags,
provider change, invitation email, resource, AWS startup, merge or deployment.
No product question is pending.

#113 final CI refresh: all CI/preview checks pass at exact head
`84c63f24d394ff8f7a0f6913a471be24f154d7c4`, including the compiled Next HTTPS
integration on Linux. It remains draft/unmerged. The user selected stripping
Authorization from customer-app requests for the first pilot; verified identity
will be supplied separately. A focused HTTP isolation policy and shared reserved
path classifier are in progress. No product question is pending and no
production or AWS startup has occurred.

HTTP isolation policy: draft
[#114](https://github.com/anirudh-makuluri/smart-deploy/pull/114), head
`742798b027a0e5410d0c432443ca1de41c9a4f4f`, on #113 / `84c63f2`.
The user confirmed stripping Authorization initially. Same-origin requests/forms
and document links work; sibling data/assets/framing/writes fail even with an
app cookie. Gateway/platform credentials, spoofed identity/routing and hop fields
are excluded from customer requests. Responses reject gateway/parent cookies,
site-wide clearing, CORS/public caching and broad callback worker scope. Dedicated
workers remain supported. Fresh never-reused private origins are required;
existing root workers are not removed and in-place conversion stays unsupported.
Shared path guards close seven parent regressions for reserved prefixes, path
parameters, double encoding and controls before customer forwarding/return paths.

Local checks pass: 146 unit files / 820 tests (59 new); 17 native HTTPS cases
(seven policy plus ten adapter/transaction); ten actual compiled Next/Better
Auth/PostgreSQL login cases; typecheck/lint/worker/final production build/diff.
Native policy uses seeded cookies/fixed identity, not real authorization/upstream;
compiled proof retains actual signed-cookie/database/API composition with fixture
approval/content and SQL verification. One new array-lookup warning was fixed;
116 focused cases and seven policy browser cases pass after the allocation-only
change. Complete pinned nine-file Doctor 100; unfiltered 618-file scan remains 84,
zero errors and the same 37 warning IDs across 26 files. No suppression.
Unchanged 107-test DB suite passes in exact #113 CI, not separately rerun locally
here; actual compiled database/browser cases repeated. Fixtures/certificates
cleaned and disposable DB stopped. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-http-isolation-1792934898227.
#113 all CI/preview checks pass at 84c63f2; #114 running. Merge order extends
#113 -> #114. This adds policy, not a customer proxy or AWS boundary. Next verify
unique upstream TLS before headers/body, then streaming/WS/private ingress,
data/secrets/usage/cost, publishing UI/tools, full >=95 and hosted acceptance.
No production migration/flags/provider change/invitation email/resource/AWS
startup/merge/deployment. No product question is pending.

#114 exact-head CI refresh: all checks pass at
742798b027a0e5410d0c432443ca1de41c9a4f4f (build/unit/typecheck/worker,
database/browser, Doctor, analytics browser proxy and Vercel preview). Draft and
unmerged; full >=95 and complete runtime acceptance remain unmet. User confirmed
Authorization stripping. Workload-specific upstream TLS is the next isolated
slice; no production or AWS startup.

### Workload TLS connector — draft #115

https://github.com/anirudh-makuluri/smart-deploy/pull/115
Head 9fe1ae2f99dda1e4e29788d8a3a20a15fc8e69d9; base
feat/gateway-http-isolation / 742798b (#114). Merge order extends #114 -> #115.
One configured RFC1918 IPv4 and unique binding/environment/release certificate;
normal validation, hostname, exact leaf pin, TLS 1.3 and HTTP/1.1 ALPN before
returning a socket for HTTP. Handshake and socket caps/cancellation; redacted
errors. No listener, runtime registrar, certificate issuance, proxy or AWS change.
Local: 147 files/872 unit tests including 52 new native TLS/configuration cases;
valid alternate chain/hostname proof and expected one-test pin-removal regression;
typecheck/lint/worker/production build/diff pass. Explicit minimal OpenSSL fixture
config corrects inherited duplicate extensions without relaxing verification.
Fixture sockets/servers close and exact generated certificate/key files removed.
Both changed code files Doctor 100; complete unfiltered 620-file scan 84, zero
errors, same 37 warning IDs/26 files. No suppression. Full >=95 remains unmet.
Unchanged DB/browser suites pass in exact #114 CI, not repeated locally for this
connector; #115 CI running including Node 20. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-upstream-tls-1792938168435.
Next compose bounded HTTP streaming with fresh authorization and runtime binding;
WS/private ingress, on-demand/cost controls, data/secrets/quotas, publishing UI,
app tools, full >=95 and hosted acceptance remain. Nothing merged, deployed,
provisioned or started; no production migration/flags/provider change/email.

#115 exact-head CI refresh: all checks pass at
9fe1ae2f99dda1e4e29788d8a3a20a15fc8e69d9, including native TLS on Node 20,
database/browser, full build/worker/typecheck, Doctor, analytics proxy and Vercel
preview. Draft/unmerged; full >=95 and complete runtime acceptance remain unmet.
Bounded HTTP streaming is in progress; no production or AWS startup.

### Bounded HTTP streaming — draft #116

https://github.com/anirudh-makuluri/smart-deploy/pull/116
Head 097217c15dc2b88ab7f684d5bc7324a08f721168; base feat/verified-upstream-tls /
9fe1ae2 (#115). Merge order extends #115 -> #116. Compose browser/header/cookie
policy and verified workload TLS before any HTTP bytes. Sequential bounded
uploads, pull response bytes, validate headers before body, preserve encoded
content/status/redirects without follow, reject upgrades. Explicit lifetime/idle/
body/concurrency caps; caller/consumer cancellation, early app completion and
runtime retirement close resources. Unknown or dishonest streams can deliver a
bounded prefix before abort; listener must terminate late output errors.
Local: 148 files/922 tests including 50 native HTTPS transport cases, expected
single cookie-policy mutation regression; typecheck/lint/worker/build/diff pass.
All 50 focused cases pass after fixture-only Duplex type correction. Fixed
identity is supplied; this does not prove authentication. TLS files removed and
servers/sockets closed. Four new code files Doctor 100; full unfiltered 624-file
scan remains 84, zero errors and same 37 warning IDs/26 files. No suppression.
Unchanged DB/browser suites pass in exact #115 CI, not repeated locally here;
#116 CI running. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-http-streaming-1792939658872.
Next authenticated composition and native listener/runtime mapping. WS, unique
certificates/private AWS ingress, wake/idle/budget, data/secrets/quotas, UI/tools,
full >=95 and hosted acceptance remain. No production flags/migrations/provider
changes/invitations/resources/startup/merge/deployment.

#116 exact-head CI refresh: all checks pass at
097217c15dc2b88ab7f684d5bc7324a08f721168, including new native HTTPS transport
cases on Node 20, database/browser, build/worker/typecheck, Doctor, analytics proxy
and Vercel preview. Draft/unmerged; full >=95 and complete runtime acceptance
remain unmet. Authenticated HTTP composition and compiled browser-to-upstream
verification are in progress. No production or AWS startup.

### Authenticated HTTP composition — draft #117

https://github.com/anirudh-makuluri/smart-deploy/pull/117
Head 4b3371eafcf8308ae00fbd3a9ca7aabcdd117d3b; base
feat/gateway-http-streaming / 097217c (#116). Merge order #116 -> #117.
Only Request input: protected browser routes, fresh current session/grant/
environment authorization then verified TLS app HTTP; no identity override.
Consistent browser/forwarding origin/binding, private login vs fetch 401,
pending admission and retirement. Bounded RPCs can finish after cancellation;
results are discarded before app forwarding. Admission authorization does not
recheck mid-response; bytes already delivered cannot be revoked.
Local 149 files/934 unit tests (12 new), 12 compiled production Next/PostgreSQL/
HTTPS browser cases (two new), typecheck/lint/worker/build/diff pass. Expected
authorization-bypass mutation failure, exact source restored. Native browser
now reaches real TLS app upstream: no browser Authorization, platform/gateway
cookies or spoofed context; revoking an admitted member's grant blocks next
fetch before any new app request. All-session logout still denies both envs.
Approval and verification remain fixture/SQL-controlled, app content fixed,
network loopback with real TLS checks. Front fixture buffers small bounded
responses; not native production bridge streaming/upload proof or hosted/OAuth/
AWS acceptance. Existing unchanged filesystem tracing build warning retained.
Complete four-file Doctor 100; full unfiltered 627-file scan 84, zero errors and
same 37 warning IDs/26 files. No suppression. Fixtures/certificates cleaned and
PostgreSQL stopped. Full unchanged DB/browser suites pass in #116 CI; new
compiled composition repeated locally. #117 CI running. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-authenticated-http-1792940815352.
Next native listener/current runtime registration, then WS/certificates/private
AWS ingress and wake/idle/budget, data/secrets/quotas, UI/tools, full >=95 and
hosted acceptance. No production flags/migrations/provider changes/invitations/
resources/startup/merge/deployment.

#117 exact-head CI refresh: all checks pass at
4b3371eafcf8308ae00fbd3a9ca7aabcdd117d3b, including composed real-TLS app
browser cases on Node 20 and full database/build/unit/typecheck/worker/Doctor/
analytics/Vercel checks. Draft/unmerged; full >=95 and complete runtime acceptance
remain unmet. Native listener bridge is in progress. No production/AWS startup.

User decision (October 25): isolate preview and published documents, files and
secrets. Publishing promotes code without automatically copying preview data,
files or secret values. Apply app + environment namespaces and secret references;
published configuration must not inherit preview secret values through copied
DeployConfig. Recorded in AWS_ON_DEMAND_PILOT_PLAN.md. Existing platform auth/DB
unchanged; no resource provisioning or data mutation. No product question pending.

### Native HTTPS protocol bridge — draft #118

https://github.com/anirudh-makuluri/smart-deploy/pull/118
Head 34ca8a69903d84ec515ce072d0c05079e74eb27a; base
feat/authenticated-http-gateway / 4b3371e (#117). Merge order #117 -> #118.
Unbound native HTTPS factory with strict registered Host/protocol/path/raw-header/
framing limits; pull input, sequential output, preserved protected callback
cookies, lifetime/idle/connection caps. Cancel unread input without destroying
the socket before early 401/413 finish. No default tenant, automatic Continue,
tunnel/upgrade or second response after late errors. No listen/process/cloud.
Local: 150 files/956 tests (22 protocol), 15 compiled production Next/PostgreSQL/
browser cases (three new), typecheck/lint/worker/build/diff pass. Actual bridge
replaces buffered fixture: uploads, readable anonymous POST with zero app
requests and real app cookie overwrite rejection/session preservation pass.
Expected input-destroy mutation socket-hang-up regression; source restored.
Header timeout fixed to remain within request timeout. Pinned five-file Doctor
100; full unfiltered 631-file scan 84, zero errors and same 37 warning IDs/26 files.
No suppression; existing filesystem tracing warning retained. Fixtures and
certificates cleaned, PostgreSQL stopped. Approval/verification/app content
remain controlled fixtures and routing is loopback with real TLS checks; no
hosted/OAuth/AWS/customer-container proof. #117 all CI/preview pass; #118 running.
Evidence C:\Users\aniru\.codex\verification\smartdeploy-native-bridge-1792943394781.
Next authoritative runtime registration and startup; WS, certificates/private
AWS ingress, wake/idle/budget, isolated preview/published data/secrets/quotas,
UI/tools, full >=95 and hosted acceptance remain. No production flags/migrations/
providers/emails/resources/startup/merge/deployment. No product question pending.

#118 exact-head CI refresh: all checks pass at
34ca8a69903d84ec515ce072d0c05079e74eb27a, including Node 20 native HTTPS/browser,
full database/unit/build/typecheck/worker, Doctor, analytics and Vercel preview.
Still draft/unmerged; full >=95 and complete runtime acceptance remain unmet.
Runtime registration metadata is in progress. No production/AWS startup.

### Runtime registration metadata — draft #119

https://github.com/anirudh-makuluri/smart-deploy/pull/119
Head 7b455cf8599470c817820a13d1250a31b1956ae6; base
feat/gateway-native-http-bridge / 34ca8a6 (#118). Merge #118 before #119.
Privileged app/environment registrations reference successful immutable AWS/ECS
release snapshots and deployment associations. Fresh private UUID origins are
permanently reserved. Serialized CAS activation switches the route, revokes the
old key and retires the old runtime. Pending/stale managed keys fail; issuance
and session checks require a live selected runtime. Sessions survive replacement
on the same binding but fail after unpublish. Preview/published selections/keys
stay separate; no documents/files/configuration/secrets copied.
Local: 150 unit files/956 tests; nine PostgreSQL files/134 tests (27 registry),
15 compiled Next/Better Auth/PostgreSQL/native HTTPS browser cases;
typecheck/lint/worker/build/diff pass. Competing selectors yield one winner;
source mutation waiting on registration cannot modify the committed snapshot.
Availability-predicate removal causes expected unpublish failure; source restored.
Fixture PID typing corrected. Two new Zod migration warnings fixed with v4
looseObject; affected 27 DB cases and all 15 browser cases repeated successfully,
with final focused schema lint and compilation. Earlier full lint passes.
Six-file Doctor 100; full unfiltered report 84, zero errors and identical
37 warning IDs/26 files. No suppression. Existing build tracing warning remains.
Fixtures/certificates cleaned and PostgreSQL stopped. Browser bindings remain
legacy fixtures; approval/verification/app content controlled, loopback TLS,
no hosted or actual AWS-attested runtime proof. CI running. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-runtime-registration-1792954224144.
No registration API/run adapter, actual ECS/all-container/ENI/VPC/subnet/SG
verification, credential/certificate provisioning, loader/process/listen or DNS
cutover. The caller must verify AWS evidence before registration. Deactivate is
unpublish, not idle stop; later wake recovery and ordered cleanup remain.
WebSockets, private ingress/wake/idle/complete $10 budget enforcement, isolated
data/secrets/quotas, UI/tools, full >=95 and hosted acceptance remain. #85 still
open/separate at 14c67e4; #118 all exact-head CI/preview pass. No production
migration/flags/provider change/invitation email/provisioning/startup/merge/deploy.

#119 exact-head CI refresh: all checks pass at
7b455cf8599470c817820a13d1250a31b1956ae6, including Node 20 database/browser,
unit/build/typecheck/worker, Doctor, analytics and Vercel preview checks. Still
draft/unmerged; full >=95 and full pilot acceptance remain unmet. Read-only AWS
task/network verification is in progress. No production/AWS startup.

### Read-only AWS runtime verification — draft #120

https://github.com/anirudh-makuluri/smart-deploy/pull/120
Head d6da294e7c420320b9e98621d92eba4a62ea739f; base
feat/app-runtime-registration / 7b455cf (#119). Merge #119 before #120.
SDK Describe checks exact task/revision/context/all-container images and the
private ENI, subnet/VPC, complete security groups and exclusive gateway-group
interface attachment. Final task re-read catches shutdown/address drift. Fixed
Linux/X86_64 Fargate 1.4.0 quarter-CPU/512-MiB/default-storage profile; two pinned
app/TLS containers, no app task IAM role/Exec/shared volumes/unsupported overrides,
scoped app/environment SSM and runtime TLS-key references. Public/extra/broad/
peering/CIDR/prefix-list ingress, foreign source group/owner, additional gateway
group interfaces, partial/paginated responses fail. SDK attempts/sockets/deadline/
pending/cancellation bounded; admission held until actual SDK work settles,
late results discarded and clients destroyed on close. Redacted errors.
Local: 151 unit files/1,044 tests (88 new), typecheck/full lint/worker/configured
production build/diff pass. Public IPv4 predicate mutation causes expected single
failure; source restored. Initial test-only Node override conflicted with shared
window setup; standard environment fixes fixture failure. SDK commands are real,
clients/response metadata mocked: no AWS requests, SigV4/IAM/live Fargate or
direct-origin proof. Unchanged DB/browser suites pass in exact parent #119 CI,
not repeated locally. Build uses disposable local DB/disabled flags and stops it;
full-suite TLS fixtures cleaned. Six-file Doctor 100; full unfiltered 640-file
report 84, zero errors and identical 37 warning IDs/26 files. No suppression;
existing filesystem tracing warnings retained. CI running. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-aws-runtime-verification-1792957373293.
Read-only, non-atomic metadata component; no production caller/launch/registration
adapter, release-fingerprint SQL recheck, actual workload TLS/readiness, IAM policy
verification or SSM/image provisioning. Egress/complete $10 budget enforcement
remain gates: outbound traffic bypasses storage-broker quotas. Workload listener,
controller, wake/idle, WebSockets, isolated data/secrets/quotas, UI/tools, full >=95
and hosted acceptance remain. #119 all CI/preview pass; #85 unchanged/separate at
14c67e4. No production migrations/flags/providers/emails/resources/startup/merge/
deployment.

#120 exact-head CI refresh: all checks pass at
d6da294e7c420320b9e98621d92eba4a62ea739f, including Node 20 SDK/unit/build/typecheck/
worker, database/browser, Doctor, analytics and Vercel preview checks. Still
draft/unmerged; full >=95 and pilot acceptance remain unmet. Standalone workload
TLS listener/container verification is in progress; no production/AWS startup.

### Workload TLS listener and packaging — draft #121

https://github.com/anirudh-makuluri/smart-deploy/pull/121
Head fb556797087de70f9b564de9e36b76cec3f558bc; base
feat/aws-runtime-verification / d6da294 (#120). Merge #120 before #121.
Three dependency-free Node CJS files implement scoped current certificate/key,
exact SNI, TLS1.3/HTTP1.1 ALPN and fixed IPv4 loopback app target. No default
certificate, user auth or platform/gateway key in task. Private AWS ingress and
separate trusted gateway remain mandatory. Bounded wire bytes, backpressure,
half-close, idle/lifetime/handshake/connections and graceful drain/forced stop.
Image copies only those files under non-root UID/GID10001. Official Node ECR
Public Linux/amd64 Node24.22.1 manifest pinned to
sha256:1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420;
anonymous SHA256/platform metadata verified, not vulnerability-scan evidence.
Local: 152 unit files/1,087 tests (43 new), two compiled entrypoint cases,
15 compiled Next/Better Auth/PostgreSQL/native gateway browser cases through
actual workload TLS -> HTTP app, typecheck/full lint/worker/standalone/build/diff
pass. SNI-guard removal causes expected single backend-admission failure; restored.
Strict identity projection/drain-admission fixtures and Node option declaration
gaps corrected without relaxing TLS. Browser verifies credentials, grants/logout,
cookies/uploads across the new hop; approval/verification/content are fixtures,
loopback transport, no hosted/AWS proof. Native process has only whitelisted env;
Windows termination is not POSIX SIGTERM proof. Docker unavailable locally;
required new Linux CI builds/runs non-root/read-only/cap-drop/resource-bound image,
checks exact /app files, actual TLS and SIGTERM. Container result pending.
Eleven-file Doctor100; full unfiltered650-file report84, zero errors and identical
37 warning IDs/26 files. No suppression. Build tracing warnings retained.
Fixtures/keys cleaned and local database/servers stopped. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-workload-tls-1792966215950.
#120 all exact-head CI/preview pass; #121 running. No production caller, launch/
registration/source-fingerprint guard, certificate/SSM lifecycle, actual AWS
ingress/readiness, image publication/scanning or live resources. Public gateway
rejects upgrades, so raw transport is not customer WebSocket support. Egress/
complete $10 admission, wake/idle, data/secrets/quotas, UI/tools, full >=95 and
hosted acceptance remain. No production migrations/flags/providers/emails/
provisioning/AWS startup/merge/deploy.

#121 initial fb55679 CI passed unit/build/native-process checks but ECR Public
returned 429 Data limit exceeded on the shared runner before container execution
(run40242143588/job121316020528). This was a failed build, not a container pass.
Repair head326f476df043b09e9b223cbabd063c2a29c6768d verifies the identical official
Docker Hub manifest/config SHA256 and changes only registry URI, preserving image
digest1200d815de24f8dcca745fbf7651d166034a35adbcad8860a8538ffff44f1420.
No login/provider mutation, weaker pin or skip. Code/test source remains identical
to the verified local snapshot. New exact-head CI/container running. Evidence
dockerhub-image.json in the existing workload verification folder. No production
or AWS startup.

#121 exact-head completion: all CI/preview checks pass at
326f476df043b09e9b223cbabd063c2a29c6768d. Run40242751244/job121317884643 executes
1,087 unit tests, two native process tests and one required Linux container test,
all pass. The pinned Node24 image serves actual TLS-to-app traffic, asserts
non-root/read-only and exact three-file /app contents, exits zero on SIGTERM.
Database/browser job121317884898 also passes. The initial fb55679 ECR Public429
failure remains recorded; identical pinned Docker Hub content repairs it without
login, weaker pin or skips. Local Docker remains unavailable; Linux CI proof is
not AWS/VPC/IAM/hosted acceptance. Draft/unmerged; full Doctor84/100 and remaining
feature gates unmet. No production or AWS startup.

Manual continuation October 25, approximately 16:20-16:41 America/Phoenix:
published draft https://github.com/anirudh-makuluri/smart-deploy/pull/122 at
0cd7b6db9a11be4f2d9ae56529f78a26174d83fc, branch feat/private-runtime-preflight,
base feat/workload-tls-listener (#121, 326f476); merge #121 first. Canonical
SQL source preflight covers the complete artifact/configuration, release and
deployment association plus binding/environment/origin. A pinned image alone
cannot authorize a changed configuration. Required fingerprint is recomputed
under registration locks; missing/changed/replayed fingerprints fail. Verified
managers prepare only IDs/pinned image/hash, without returning config or secrets.
This is privileged consistency checking, not an HTTP principal or AWS/TLS proof;
external checks must repeat on drift. No cloud wait inside SQL transactions.

Local: 152 unit files/1,087 tests; nine PostgreSQL files/146 tests (39 registry,
12 new, all39 repeated on final source); two compiled workload process cases;
all15 compiled Next/Better Auth/PostgreSQL/native gateway -> workload TLS -> HTTP
browser cases; typecheck/full lint/worker/workload/production build/diff pass.
Removing fingerprint comparison causes expected stale-config failure; exact
source restored. Initial JSON-order fixture annotation corrected. Three-file
Doctor100; full unfiltered650-file84, zero errors and identical37 warning IDs/
26 files, no suppression. Build tracing warnings retained. Fixtures/keys cleaned;
database and servers stopped. Docker unavailable locally; unchanged container
passes exact parent #121 Linux CI. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-private-runtime-preflight-1792970551305.
Exact publisher identity anirudh-makuluri verified; only intended six files
committed, staged diff check and commit hook passed. Attached PR; issue99 updated.
#121 remains draft/unmerged at verified326f476; billing #85 remains separate/open
at14c67e452be54c6639ac2a7f3a69737b269c1999. #122 exact-head CI pending.

No production caller, migration, AWS calls/provisioning/startup or rollout merge/
deploy. Trusted controller/AWS/TLS composition, certificate/credential lifecycle,
egress/complete $10 budget, wake/idle, isolated data/secrets/quotas, UI/tools,
WebSockets, full Doctor>=95 and hosted acceptance remain unfinished. Data deletion/
retention policy clarification remains pending; independent source work continued.

#122 exact-head completion: all CI/preview checks pass at
0cd7b6db9a11be4f2d9ae56529f78a26174d83fc. Run40245835897/build job121327078209
executes 1,087 unit tests, two native process cases and one required Linux Docker
case, including non-root/read-only execution and SIGTERM; all pass. Database/
browser job121327078345 also passes. Generic CI build logs default-secret
configuration warnings; it is not production authentication proof. The separate
explicit-secret browser fixture passes. All current #119-#121 heads also refreshed
passing. Local Docker remains unavailable; Linux CI is distinct from actual AWS/
Fargate/IAM/direct-origin/hosted acceptance. Draft/unmerged, full Doctor84/100 and
remaining pilot gates remain unmet. No production or AWS startup.

User decision October 25: deleted app documents and files remain recoverable for
seven days. Access/runtime credentials are revoked immediately, retained bytes
continue counting against storage quotas until actual removal, and preview/
published data stay separate. Recovery does not revive old credentials/sessions.
The previous retention-policy question is answered; document-store work resumes.

Manual continuation October25, document storage foundation: published draft
https://github.com/anirudh-makuluri/smart-deploy/pull/123 at
7699bdc92e034ec762475a5d4a476ca65e67922a, branch feat/app-document-data, base
feat/private-runtime-preflight (#122/0cd7b6d); merge#122first. Stable app/env
document keys, transactional snapshots/conditional quota arithmetic, fresh UUID
document tokens against delete/recreate ABA, bounded JSON/keys and redacted errors.
Seven-day data tombstone denies document reads/writes in both environments while
keeping data/quota; restore only before deadline, irreversible purge claim only
afterward, no premature quota release. Generation guard blocks writes delayed
across delete/restore. Scope is not authentication; no public broker or full
app-delete coordinator is exposed. Data restore must not revive old credentials.

Local153unit files/1,091tests (four new schema cases),33real DynamoDB Local3.3.2
cases, two compiled workload process cases, typecheck/full lint/worker/workload/
production build/diff pass. Removing lifecycle generation guard permits stale
write and produces expected regression; exact source restored. Initial stored
usage projection rejected key fields and was corrected. Verification runner's
initial HTTP build auth URL affected one secure-cookie unit expectation; build
env is now scoped and full suite repeated successfully. A partial unit run was
stopped during ABA review, then final source fully verified. Build tracing warnings
retained. Six-file Doctor100; full unfiltered656-file84, zero errors and same37
warning IDs/26files, no suppression. Emulator fixture config binds Jetty loopback
before startup, disables telemetry, uses explicit dummy SDK credentials. Official
archive SHA256667cde09f96f4785cede4d107d8066011e5eeceb5dd4566ea8c74c0d378fe919.
Processes/fixtures cleaned; disposable PostgreSQL stopped. New required Java17
emulator CI step pending. Unchanged SQL/browser/container checks pass exact parent
#122 CI. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-app-documents-1792977079864.
Exact publisher identity anirudh-makuluri verified, only intended11files committed,
staged diff/commit hook pass, PR attached and issue99 updated. Parent#122 remains
open/unmerged0cd7b6d; billing#85 remains separate/open14c67e4. No AWS account table,
IAM/S3/provider state/SQL migration/startup/production/rollout merge/deploy.

This is document storage only, not completed app data delivery. Retained usage is
a conservative logical reservation, not exact AWS metering or a complete $10 cap.
Current-authorized broker, immediate whole-app access/runtime/data credential
revocation, S3 files/listing/physical purge/quota release/backups, launch/wake,
complete request/egress/cost admission, UI/tools/WebSockets, full Doctor>=95 and
hosted acceptance remain unmet.

#123 exact-head completion: all CI/preview checks pass at
7699bdc92e034ec762475a5d4a476ca65e67922a. Run40256129260/build job121358245571
executes1,091unit tests, the new33real DynamoDB Local3.3.2 cases under Java17,
two native process cases and one required Linux container case (non-root/read-only,
SIGTERM), all pass. Database/browser job121358245720 also passes. Generic CI build
logs default-secret configuration warnings; configured browser auth fixtures are
separate proof, not production authentication evidence. Linux emulator proof is
distinct from actual AWS IAM/durability/backups/hosted acceptance. PR description
and issue99 exact-head row updated. Draft/unmerged, full Doctor84/100 and remaining
pilot gates unmet. No AWS provisioning/startup or production.

## MVP scope and cost decision (October 25, latest user instructions)

The user narrowed the release to demonstrating the architecture through the
user flow and finishing the current PRs for production. Defer app-scoped agent
CLI/MCP tools, the ALB-to-Nginx/Certbot migration, and broader file/admin features.
Keep ALB with ACM for the demonstration. Existing Better Auth/Supabase platform
dependencies remain unchanged. The representative acceptance flow is one private
app: verified sign-in, colleague app-use grant, document save, redeploy preserving
that document, and access revocation. Preview/published isolation and existing
private-origin protections still apply.

The user explicitly selected a time-boxed demo within the existing $10 additional
monthly AWS budget, including automatic runtime/ALB teardown afterward. This
supersedes the requirement to finish all deferred agent/file/admin work before
this MVP release; it does not waive repository-wide React Doctor >=95, relevant
integration/build/browser checks, reviewed infrastructure/migration/rollback
plans, secure private access, or actual hosted acceptance. A controlled demo must
be identified as such and must not be represented as general arbitrary-app
rollout completion. No always-on ALB/worker budget was approved. Durable cleanup,
owned-resource boundaries, safe shared-worker shutdown, current cost estimates,
and a bounded demo end time are prerequisites to starting billable resources.

Release-health work is active on fix/mvp-release-health, based on the exact #123
head 7699bdc92e034ec762475a5d4a476ca65e67922a. A fresh inventory confirms all 31
rollout PR heads are ancestors of that candidate; all remain open, 30 drafts.
Latest required checks pass, but that alone is not production acceptance. The
full initial scan reproduced 84/100; the first behavior-preserving fixes reach
89/100 with zero errors. Cleanup verification continues. Billing #85 remains
separate. AWS read-only inventory found the existing t3.small worker stopped;
no resources have been started/provisioned and no rollout PR merged/deployed.

MVP release-health session update: all31 rollout PR review-thread lists are empty.
The candidate cleanup now passes a complete unfiltered React Doctor0.9.18 scan:
100/100, zero errors/warnings,666files at that scan. No suppressions or rule changes.
New GitHub dispatch tests exposed an existing detached WebCrypto randomUUID call;
the default now invokes it on its receiver. Independent row reservations dispatch
at concurrency2, stop further admission on failure, and drain already-started
work before returning an error. Five queue unit cases and two actual PostgreSQL
transaction/concurrent-delivery cases pass. Synthetic four-job/40ms queue-delay
measurements are retained as local evidence only, not AWS performance proof.
The full pre-queue-change rerun passes158files/1114tests. One initial first-import
5000ms approval-test timeout was repaired by moving server-module loading into
beforeAll fixture setup; request tests retain their existing timeout. Final full
candidate verification (including the queue changes) is active, serial/capped.

Read-only live prerequisites: us-west-2 has no ALB; the smart-deploy.xyz wildcard
ACM certificate is expired. Worker secret lacks the two new private-app flags.
A certificate-verified, read-only production PostgreSQL metadata transaction
confirms no app/workspace tables or deployment association columns are applied.
The platform remains Supabase/Better Auth. The vendor CA was obtained from the
project dashboard's certificate link; certificate verification was not disabled.
Temporary dashboard login was signed out. No settings, migrations, flags,
provider connections, cloud resources, rollout merges or production deployments
were changed. Broader runtime loader/data broker/MVP wiring, valid app certificate,
reviewed migration/rollback and durable bounded demo cleanup remain required.

Published focused release-health PRs:
- #124 https://github.com/anirudh-makuluri/smart-deploy/pull/124
  fix/mvp-release-health at7b078785b75d319c133e3f14e6ff950fc37497b2,
  base#123/feat/app-document-data.42intendedfiles, view/response cleanup;
  standalone full scan92/100, requires#125 before the >=95 merge gate.
- #125 https://github.com/anirudh-makuluri/smart-deploy/pull/125
  fix/github-push-dispatch atd026bc3e2a31eb524effeb3988aa8ed7757577df,
  base#124/fix/mvp-release-health.8intendedfiles, bounded dispatch/default UUID,
  real SQL concurrency tests, full quality gate and compiled public/browser CI.
Both attached; issue99 guarded owner/table updates include latest scope and heads.
Publisher identity anirudh-makuluri reverified; main remains an ancestor. Billing#85
is still open/separate14c67e4; #123 remains unmerged7699bdc. All31 inherited PR
review-thread lists are empty. No rollout merge or production change.

Final combined local candidate:158unit files/1117tests;10PostgreSQLfiles/148tests;
33DynamoDBLocalcases;2compilednativeTLSprocesscases;15compiledprivatebrowsercases
plus5compiledpublic/analyticscases. Typecheck, lint, worker/workload/production
build and diff checks pass. Unfiltered Doctor0.9.18 complete668files100/100,
zeroerrors/warnings/skips; changed-file and explicit staged scans100 as well.
No suppression/threshold change. First view commit's common hook fallback printed
its generic regression message (it discards detailed output); explicit pinned
full/diff/staged scans pass, and final dispatch commit's same pinned hook passes.
All local fixtures/emulator/database stopped; no Docker locally. Linux container
and exact-head CI remain separate required proof. Evidence root:
C:\Users\aniru\.codex\verification\smartdeploy-mvp-release-1792983590170.

At publication, #124 run40268560768 build121396188981/database121396188737
and #125 run40268591579 build121396282454/database121396282665 are running.
Separate Doctor actions report scoped100; this is distinct from #125's new full
repository step. Vercel preview pending, browser-proxy checks running. Keep draft
status until current exact-head results are known; no open PR counts as completion.
Next required MVP work is composing the current-authorized document broker and
trusted runtime loader/controller, then durable bounded demo provisioning/cleanup,
reviewed platform migration/certificate plan and actual hosted acceptance. Agent
CLI/MCP, Nginx migration and broader file/admin scope stay deferred.

#124/#125 exact-head CI completion: all CI and Vercel preview checks pass at
7b078785b75d319c133e3f14e6ff950fc37497b2 / d026bc3e2a31eb524effeb3988aa8ed7757577df.
#125 run40268591579/build121396282454 executes1117unit,33realDynamoDBLocal,
2nativeTLSprocess,1Linuxcontainertest, and the new complete668-file Doctor release
gate100/100. Database121396282665 executes148SQL, all inherited browser suites,
15compiledprivate-app and5compiledpublic/analytics cases, all pass. #124 run
40268560768 also passes; its separate scopedDoctor100 is not a standalone full
>=95 claim. Required Linux container evidence now exists at the exact leaf head;
local Docker remains unavailable. PR descriptions/issue99 updated. Draft/unmerged;
no provisioning, migrations, startup, provider changes or production deployment.

Document API slice: feat/private-app-document-api is based on exact #125 head
d026bc3e2a31eb524effeb3988aa8ed7757577df. The disabled machine endpoint derives
verified identity and app/environment from current managed runtime/session SQL,
rechecks app admission, rejects caller scope and browser credentials, and limits
get/put/remove to one explicitly allowlisted app/table ARN. Storage abort reaches
all seven SDK commands; body/HTTP/SDK deadlines and process concurrency are bounded.
This does not establish a global budget cap or atomic SQL/DynamoDB authorization.
Unavailable writes require reconciliation. No flags/resources/migrations changed.

Final serial local proof: 161 unit files/1157 tests, 10 PostgreSQL files/151 tests,
33 real DynamoDB Local cases, two compiled native TLS process cases, 15 compiled
private-app browser and five compiled public/analytics cases, typecheck, lint and
production/worker/workload builds all pass. Complete unfiltered Doctor 0.9.18:
674 files, 100/100, zero errors/warnings/skips. Removing the managed-runtime guard
fails its regression test. The initial strict-union inference and revoked-session
fixture errors were repaired; permissions restoration cannot revive an old session.
Owned disposable database/emulator/fixtures stopped. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-document-api-1792990297824.
Native browser-to-document integration and the trusted runtime loader/controller
remain next, followed by bounded AWS demo cleanup/provisioning, reviewed live
migration/certificate and hosted acceptance. No rollout merge or production deploy.

Published #126 https://github.com/anirudh-makuluri/smart-deploy/pull/126 at
b6b81f3201d668ef2d878a6f9051745a3831a263, stacked on #125/fix/github-push-dispatch;
draft, attached, intended 16 files. Publisher identity reverified. Exact-head CI
is pending. Issue99 ownership-guarded table updated. Next slice uses separate
feat/gateway-document-access branch. No production changes.

#126 exact-head completion: all checks and Vercel preview pass at b6b81f3.
Run40272492614/build121408118260 passes the required Linux container and complete
674-file Doctor gate100/100 as well as unit/storage/native-process checks.
Database121408118026 passes151SQL and all inherited browser suites, including
15compiledprivate-app and5public/analytics cases. Issue99/PR evidence updated;
no hosted acceptance or production changes. The gateway browser-data follow-up
has136focusedunitcases and3actualnativeHTTPS/Chromium cases passing. That browser
transport/storage is an explicit in-memory fixture, not real SQL/AWS/redeploy
proof. Full serial follow-up validation is active before publishing it.

Published #127 https://github.com/anirudh-makuluri/smart-deploy/pull/127 at
e42429779746bc18efb63a559fb5e3cb21e9b81d, base#126/feat/private-app-document-api,
draft and attached. The explicitly enabled native broker uses the HttpOnly app
session and exact same-origin POST proof, never forwards data calls to customer
HTTP or accepts caller scope, and validates bounded machine replies. Review also
fixed normalization expansion beyond the stored eight-KiB limit (5012-byte
exponential-number input previously normalized to9012). No mutation retries.

Final local proof:162unitfiles/1209tests,151SQLtests,33realDynamoDBLocalcases,
2nativeTLSprocesscases,15compiledprivate-app,5compiledpublic/analytics and21
combinedcookie/nativebrowsercases all pass. The three new Chromium/HTTPS broker
cases are included in21; rejected sibling-form requests verifiably carry the app
cookie. Fixture control/data remain in-memory, not real AWS/redeploy/hosted proof.
Typecheck/full lint/production/worker/workload builds and final diff checks pass.
Full unfiltered Doctor0.9.18:677files100/100,zeroerrors/warnings/skips; pinned hook
passes. Initial header inference and disabled-route status fixture errors repaired.
Full units/storage/worker checks rerun after normalization fix; browser capture
assertion followed by its three-case rerun/lint and another complete Doctor gate.
Owned fixtures/emulator/database stopped. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-gateway-documents-1792996694268.
Exact-head CI/Linux container pending. Next branch feat/private-runtime-gateway-loader
starts on #127. No rollout merge, provisioning, migrations, enablement or deploy.

#127 exact-head CI completion: all checks and Vercel preview pass at e424297.
Run40283309497/build121441185466 passes1209unit,33DynamoDBLocal,2nativeprocess,
1requiredLinuxcontainer and complete677-file Doctor100/100. Database121441185263
passes151SQL,21cookie/nativebrowser,15compiledprivate-app,5public/analytics and
inheritedauthbrowser checks. PR evidence updated; draft/unmerged, no hosted proof.

Active uncommitted runtime-loader slice is on feat/private-runtime-gateway-loader,
based on#127. It loads only current selected SQL metadata, exact SecureString SSM
path/ARN/credential, live credential authentication and pinned private TLS; rechecks
selection before returning a gateway. Reloads preserve unchanged login state,
retire changed selections, fail closed on error/staleness and expire within an
explicit two-hour maximum. An operator-only compiled gateway entrypoint requires
explicit flags/config/files, verified database TLS, bounded SQL/SDK IO and graceful
shutdown. It starts no AWS resource or platform migration. Durable AWS resource
teardown, trusted AWS observation/registration controller and hosted proof remain.

Focused proof:44newunitcases,2actualPostgreSQL/pinnedTLS integration cases and2
compiledgatewayprocess cases pass. SQL/SSM/control transport in the standalone
process fixture is explicitly fake; workload/frontendTLS and process expiry are
real. The SQL cases use real current/key/session/grant queries with mocked SSM
and storage. Initial fixture TLS overload/socket typing, wrong grant method name,
CJS lint and Windows ESM file-URL errors were corrected. Full initial Doctor:
688files100/100,zeroerrors/warnings/skips. Full serial validation is now active.

Published #128 https://github.com/anirudh-makuluri/smart-deploy/pull/128 at
8ea3e37d8665a6025be5b46cea08478616e578a1, base#127/feat/gateway-document-access,
draft and attached. Final full serial local proof:165unitfiles/1253tests,
10SQLfiles/153tests,33DynamoDBLocal,2compiledworkloadprocess,2compiledgatewayprocess,
15compiledprivate-app,5compiledpublic/analytics and21cookie/nativebrowser cases
all pass. Typecheck/full lint/production/worker/workload builds, final diff and
pinned commit hook pass; complete688-file Doctor100/100,zeroerrors/warnings/skips.
Owned fixtures/TLS material/emulator/database stopped. Evidence:
C:\Users\aniru\.codex\verification\smartdeploy-managed-gateway-1793027426842.
Exact-head CI/Linux container pending. No production mutations. New branch
feat/aws-demo-guard starts on#128 for durable cleanup/budget preparation.

Fresh read-only inventory on October26: publisher/account identity remain expected,
main is still a8af9f3; AWS328342419078 uses default-user in us-west-2. Worker
i-0c66e86b605f71ef9 remains stopped. Its legacy SG allows only80/443 plus unusable
0.0.0.0/32 SSH; it does not expose the intended8444 gateway target port. An added
ALB-source-only gateway SG can preserve those existing rules/connections. No
instance, group, connection, migration, flag, certificate or provider was changed.

Current public AWS Price List reads: t3.small0.0208/hour(SKU8UZJBKH62FYWW5EG),
ALB0.0225/hour(7AKU6NT3G9ZEJTB5),LCU0.008/hour(2ETY8Y426S4237JU),
FargateLinuxvCPU0.04048/hour(EKCCQUSFCBDDTKTS),memory0.004445/GiB-hour
(NTC2QZFJW79R5XVK),publicIPv40.005/address-hour(NBHXEKTE88TJDDQF),
DDBstandardwrite0.000000625/unit(4G4G98VBTENWGY5R),read0.000000125/unit
(K6UMRY3TVDVCBP56),storage0.25/GiB-month beyondFreeTier(UNCJFSHZ2ZQGDPJV).
Python Decimal conservative3h calculation (three .25vCPU/.5GiB tasks,worker,ALB,
1LCU,sixIPv4,DDB25read/writeunits/sec,2MiBretainedfullmonth) is0.55797078125USD.
This is only the base subtotal: builds,ECR,logs,transfer,taxes and teardown failure
margin remain before final budget admission. It is not a hard total-cost claim.
No Free Tier credits assumed. CloudFormation/Serverless/Cost skills and relevant
references loaded; cfn-lint/cfn-guard and Python bindings are absent locally.
No tool installation, template deployment or provisioning has occurred.

October26 follow-up: the user explicitly approved isolated cfn-lint/cfn-guard
installation, superseding the missing-validator state above. Both are installed
under C:\Users\aniru\.codex\verification\cloudformation-tools, without global or
PATH changes. cfn-lint1.58.0 and official checksum-verified Guard3.2.1 validate the
new cleanup-only template: zero schema findings, all six compliance rules pass,
all eight unsafe mutations fail their expected rule. Basic AWS validate-template
passes with15parameters/CAPABILITY_IAM; it is not a deployed change set.

#128 exact-head CI/preview refresh is complete at8ea3e37. Run40349423079,
build121665082582 actually runs both compiled gateway process cases, the required
Linux container case and full688-file Doctor100/100. All pass. The PR and
issue99 row are updated. Billing#85 remains separate/open14c67e4. No rollout
merge or production mutation.

Active uncommitted slice feat/aws-demo-guard is based on#128. It renders a
separate cleanup stack directly from hashed reviewed TypeScript, with a shared
two-hour-maximum expiry, one-minute schedule and bounded thirty-minute retry
window, encrypted failure queue/seven-day logs, concurrencyone,45s application
deadline/60s Lambda limit. Independent ownership-checked paths stop only the
leased worker, three exact tagged services, one tagged ALB and six tagged SSM
parameters, then request owned workload-stack deletion. It never reads secret
values or deletes application data. Existing ENI groups are freshly read; group
replacement has no CAS, so the demo lease must exclude other network writers.
Completion requires observed terminal AWS states rather than accepted requests.

Focused28unit cases pass, including generated inline CommonJS execution with
the real local SDK before expiry, plus deadline and late-response mutation
checks. Access Analyzer returns no findings for both identity policies and both
trust policies. Nine explicit IAM simulations pass: matching worker/ENI leases
allow exact operations; wrong leases, other worker, shared ALB, document-table
deletion, file-bucket deletion and SSM secret reads are denied. These read-only
checks do not establish actual role/deletion/ingress behavior. Complete initial
696-file Doctor100/100 after repairing six diagnostics without suppression.
Full serial local verification is active. Actual-manifest change-set validation,
workload/provisioning/admission composition, complete cost estimate, hosted UI
and end-to-end proof remain. The existing AWS worker remains stopped; no
schedule, role, stack, parameter, certificate, flag or cloud resource was created.

Published draft#129 https://github.com/anirudh-makuluri/smart-deploy/pull/129 at
c2319bb80cce57f02b95966e60e9295d1660e8a6, base#128/
feat/private-runtime-gateway-loader. Attached; exact-head CI pending. Full serial
broader proof passes169unitfiles/1281tests,153SQL,33DynamoDBLocal,2gatewayprocess,
2workloadprocess,15compiledprivate-app,5public/analytics,21cookie/nativebrowser,
typecheck/full lint/production/worker/workload builds. Subsequent guard-only edge
refinements add strict trailing-newline rejection and observational handling of
zero-task INACTIVE service records after tag removal. All39finalfocused tests,
typecheck/focusedlint/workerbuild/finaltemplate/schema/sixrules/eightmutations
pass. Final complete696-file Doctor100/100,zeroerrors/warnings/skips, no
suppression. Final AWS basic template check passes; actual-manifest deployed
change-set validation remains pending. All fixtures and owned local PostgreSQL
stopped. Evidence C:\Users\aniru\.codex\verification\smartdeploy-demo-guard-1793032523772
and demo-guard-* reports in the verification root. The user selected a colleague
account for hosted QA; a strictly CA-verified read-only database lookup confirmed
it exists and is verified. No invitation, account edit or email was performed.
Creator/colleague distinction still needs verification during hosted acceptance.
No rollout merge, production migration/configuration, AWS provisioning or start.
