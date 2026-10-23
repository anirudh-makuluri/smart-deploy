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
- Preserve the uncommitted K3s/Oracle/GCP work in the original checkout. It is
  excluded from this rollout, rather than deleted or incorporated.
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
| Kickoff | Prepared | Clean managed worktree from origin/main; original K3s checkout preserved. |
| Existing billing | Separate open PR at kickoff | https://github.com/anirudh-makuluri/smart-deploy/pull/85 |
| Slices 1-7 | Pending | No implementation or hosted proof claimed by this planning document. |
