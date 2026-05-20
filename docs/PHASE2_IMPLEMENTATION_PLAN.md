# Phase 2 Implementation Plan

## Summary

Phase 2 makes Smart Deploy behave like an EC2-first DevOps agent with explicit user approval.

The deployment flow remains:

1. Generate infra artifacts with `sd-artifacts`
2. Deploy and stream logs
3. Verify the application URL
4. If deployment or runtime health fails, generate a remediation attempt
5. Show the user a human-readable plan with an optional diff view
6. If approved, apply the remediation, redeploy, and verify again
7. After a successful deploy, monitor URL health for 5 minutes

Important constraint:

- Remediation planning must use the existing `sd-artifacts` feedback stream flow via `/api/feedback/stream`
- Phase 2 may edit generated artifacts and Smart Deploy deploy/runtime config
- Phase 2 must not edit application source code
- Phase 2 is EC2-only

## Goals

- Add URL health verification immediately after deploy
- Add a 5-minute post-success monitoring window
- Add user-approved remediation attempts
- Reuse `sd-artifacts` feedback streaming for artifact-level remediation
- Keep all agent actions transparent before execution
- Stop after a configurable per-deployment retry limit

## Non-Goals

- Editing GitHub repository source code
- Creating PRs
- Cloud Run auto-remediation
- Screenshot or semantic validation
- Fully autonomous retry loops without approval

## Proposed Deliverables

- New deployment lifecycle states for verification, approval, remediation, and monitoring
- A structured remediation attempt model persisted with deployment history
- URL health checks for EC2 deployments
- UI surfaces for:
  - remediation plan
  - diff preview
  - approve/reject actions
  - monitoring status
- Integration with `/api/feedback/stream` for artifact remediation
- A bounded retry loop per deployment

## Implementation Strategy

Build Phase 2 in narrow vertical slices. Each task below should be small enough to implement and validate independently.

---

## Task 1: Add Phase 2 Domain Model

### Scope

Define the core states and payload shapes needed for verification, monitoring, and remediation.

### Work

- Extend deployment lifecycle states
- Add retry-related fields to deployment config
- Define health check result types
- Define remediation attempt and remediation plan types
- Define websocket event payload types for new Phase 2 events

### Suggested files

- `src/app/types.ts`
- `src/custom-hooks/useWorkerWebSocket.ts`
- `src/lib/graphql/types.ts`

### Acceptance criteria

- TypeScript types exist for Phase 2 states and payloads
- New lifecycle states can represent approval, remediation, and monitoring
- Retry limit is configurable per deployment

---

## Task 2: Add Persistence for Remediation Attempts and Health Checks

### Scope

Persist the new Phase 2 events so the UI and history can survive refreshes and reconnects.

### Work

- Add storage for remediation attempts
- Add storage for deployment health checks
- Add helper methods in the DB layer
- Extend deployment history reads to include remediation metadata

### Suggested files

- `supabase/schema.sql`
- `src/db-helper.ts`
- `src/lib/graphql/resolvers/query.ts`
- `src/lib/graphql/resolvers/mutation.ts`

### Acceptance criteria

- Remediation attempts can be saved and retrieved
- Health check results can be saved and retrieved
- Deployment history can show Phase 2 attempts after reload

---

## Task 3: Add EC2 URL Health Verification Service

### Scope

Create a reusable backend service that verifies whether a deployed EC2 app URL is reachable and healthy from a network/HTTP perspective.

### Work

- Create a URL verifier service
- Classify failures as:
  - DNS failure
  - connection refused
  - timeout
  - TLS error
  - redirect loop
  - HTTP error
- Return structured output including status, latency, and error details
- Keep the first version simple and deterministic

### Suggested files

- `src/lib/` new health verification module
- `src/app/api/health/route.ts` only if shared helpers make sense
- `tests/unit/api/health.route.test.ts` or new dedicated tests

### Acceptance criteria

- The verifier can classify healthy vs unhealthy URLs
- The output is structured enough to drive remediation decisions
- Unit tests cover the major failure classes

---

## Task 4: Run Verification at the End of EC2 Deploys

### Scope

Wire post-deploy verification into the EC2 deploy flow before declaring the deployment healthy.

### Work

- Invoke the URL verifier after deploy URL becomes available
- Emit websocket progress messages before and after verification
- Persist the verification result
- Mark lifecycle state accordingly

### Suggested files

- `src/lib/handleDeploy.ts`
- `src/lib/aws/handleEC2.ts`
- `src/lib/websocketLogger.ts`

### Acceptance criteria

- A deploy is not considered fully successful until verification runs
- Verification results show up in logs and persisted history
- Failure to verify can trigger the remediation path

---

## Task 5: Add 5-Minute Monitoring Window After Success

### Scope

Once the deploy passes verification, continue health checks for 5 minutes and surface the current monitoring state in the UI.

### Work

- Start a 5-minute monitoring window after successful verification
- Poll URL health on a fixed interval
- Persist health check results
- Emit websocket events for monitoring start, updates, and completion

### Suggested files

- `src/lib/handleDeploy.ts`
- `src/custom-hooks/useWorkerWebSocket.ts`
- `src/components/DeployWorkspace.tsx`
- `src/components/deploy-workspace/DeployLogsView.tsx`

### Acceptance criteria

- Successful deployments enter a visible monitoring state
- Monitoring ends automatically after 5 minutes
- Monitoring failures can trigger remediation proposal generation

---

## Task 6: Build a Remediation Attempt Orchestrator

### Scope

Introduce a single orchestration layer that decides when to create a remediation attempt and tracks retry count.

### Work

- Create a remediation coordinator/orchestrator
- Accept two triggers:
  - deploy failure
  - post-deploy unhealthy URL
- Enforce `maxAutoFixRetries` per deployment
- Create attempt records with status transitions
- Stop cleanly when retries are exhausted

### Suggested files

- `src/lib/` new remediation coordinator module
- `src/lib/handleDeploy.ts`
- `src/db-helper.ts`

### Acceptance criteria

- Retry count is enforced per deployment
- Both failure triggers can create remediation attempts
- Exhausted retries move the deployment into a final terminal state

---

## Task 7: Route Artifact Remediation Through `sd-artifacts` Feedback Stream

### Scope

Use the existing feedback streaming path as the primary artifact remediation mechanism.

### Work

- Reuse `/api/feedback/stream`
- Build a Phase 2 remediation payload from:
  - deployment failure summary
  - health failure classification
  - recent deploy logs
  - relevant config snapshot
  - failed artifact scope
- Convert remediation intent into feedback text compatible with `sd-artifacts`
- Capture improved artifact outputs when the feedback workflow completes

### Suggested files

- `src/app/api/feedback/stream/route.ts`
- `src/components/FeedbackProgress.tsx`
- `src/components/DeployWorkspace.tsx`
- `src/lib/scanResultNormalization.ts`

### Acceptance criteria

- Phase 2 remediation can start from the existing feedback stream endpoint
- The returned artifact payload can be reused by the deployment flow
- No parallel artifact-remediation backend is introduced

---

## Task 8: Define Diff Generation for Proposed Remediation

### Scope

Before the user approves a retry, the system must be able to show what would change.

### Work

- Compare current artifacts/config against proposed artifacts/config
- Produce a compact diff preview for the UI
- Support both:
  - artifact changes from `sd-artifacts`
  - Smart Deploy runtime/config changes

### Suggested files

- `src/lib/` new diff helper module
- `src/components/DeployWorkspace.tsx`
- `src/components/deploy-workspace/DeployLogsView.tsx`

### Acceptance criteria

- Each remediation attempt has a human-readable summary
- A diff preview can be opened before approval
- The diff only includes allowed file/config changes

---

## Task 9: Add the Remediation Plan UI

### Scope

Create the approval UX for a single retry attempt.

### Work

- Add a remediation plan card or panel
- Show:
  - root cause summary
  - planned changes
  - retry number
  - confidence/risk if available
- Add actions:
  - approve retry
  - reject retry
  - view diff
- Integrate the feedback progress view into the remediation experience

### Suggested files

- `src/components/DeployWorkspace.tsx`
- `src/components/deploy-workspace/DeployLogsView.tsx`
- new remediation-specific UI components if needed

### Acceptance criteria

- The user can approve or reject a whole retry attempt
- The plan is readable without opening the diff
- The diff can be opened on demand

---

## Task 10: Apply Approved Remediation and Redeploy

### Scope

Once the user approves, apply the updated artifacts/config and re-enter the deploy flow automatically.

### Work

- Save approved artifact/config changes into the active deployment state
- Re-run the deploy flow with updated inputs
- Stream “what I am about to do” messages before each apply/redeploy step
- Record outcome against the remediation attempt

### Suggested files

- `src/lib/handleDeploy.ts`
- `src/components/DeployWorkspace.tsx`
- `src/db-helper.ts`

### Acceptance criteria

- Approval triggers apply + redeploy automatically
- The redeploy uses the updated artifacts/config
- The remediation attempt outcome is persisted

---

## Task 11: Add Smart Deploy Runtime/Config Remediation Rules

### Scope

Artifact improvements alone may not be enough. Add a small deterministic ruleset for Smart Deploy-managed runtime/config changes.

### Work

- Support bounded fixes such as:
  - container port mapping mismatch
  - nginx upstream mismatch
  - health check path mismatch
  - warm-up timing adjustment
  - env var wiring fixes in Smart Deploy-managed config
- Keep this ruleset explicit and auditable
- Include these changes in the same approval attempt and diff view

### Suggested files

- `src/lib/handleDeploy.ts`
- `src/lib/deployInfraDefaults.ts`
- `src/lib/nginxConf.ts`
- `src/lib/utils.ts`
- `src/components/blueprint/` only if config UI needs updates

### Acceptance criteria

- Runtime/config fixes can be proposed alongside artifact fixes
- Only allowed Phase 2 surfaces are editable
- The user can see these changes before approval

---

## Task 12: Add APIs or Mutations for Approve/Reject/Diff

### Scope

Create the control surfaces needed by the UI for remediation lifecycle actions.

### Work

- Add approve action
- Add reject action
- Add diff retrieval action if diff is stored separately
- Ensure actions are authorized per deployment owner

### Suggested files

- `src/lib/graphql/resolvers/mutation.ts`
- `src/lib/graphql/resolvers/query.ts`
- `src/lib/graphql/schema.ts`
- `src/lib/graphqlClient.ts`

### Acceptance criteria

- The UI can approve and reject a remediation attempt
- Diff preview is retrievable when needed
- Ownership and auth checks are enforced

---

## Task 13: Surface Remediation and Monitoring in Deployment History

### Scope

Make Phase 2 observable after the live session ends.

### Work

- Show remediation attempts in deployment history
- Show monitoring results and health failures
- Distinguish:
  - original deploy failure
  - approved remediation
  - rejected remediation
  - retry exhaustion

### Suggested files

- `src/components/DeploymentHistory.tsx`
- `src/components/DeploymentHistoryTable.tsx`
- `src/custom-hooks/useDeploymentHistoryWithSync.ts`

### Acceptance criteria

- Users can understand what happened from history alone
- Monitoring and remediation events persist across refreshes

---

## Task 14: Testing Pass for Phase 2 Core Flows

### Scope

Add enough test coverage to make the retry loop safe to ship.

### Work

- Add unit tests for:
  - URL health classification
  - retry exhaustion logic
  - remediation diff generation
  - approval/rejection transitions
- Add integration tests for:
  - failed deploy -> remediation proposal
  - approve retry -> redeploy
  - successful deploy -> monitoring -> unhealthy -> remediation proposal

### Suggested files

- `tests/unit/`
- `tests/e2e/deploy-workspace.spec.ts`

### Acceptance criteria

- The critical Phase 2 transitions are covered by tests
- Retry limit behavior is validated
- The approval loop is validated

---

## Task 15: Documentation and Rollout Guardrails

### Scope

Document how Phase 2 works and make the feature safe to enable gradually.

### Work

- Add operator-facing docs for Phase 2 behavior
- Document retry limit semantics
- Document the no-app-code-edit guarantee
- Add a feature flag if rollout should be staged

### Suggested files

- `README.md`
- `docs/TROUBLESHOOTING.md`
- new feature doc if needed

### Acceptance criteria

- Team members can understand the Phase 2 flow from docs
- Rollout can be controlled safely if needed

---

## Recommended Order

Implement in this order:

1. Task 1: domain model
2. Task 2: persistence
3. Task 3: health verifier
4. Task 4: post-deploy verification
5. Task 5: monitoring window
6. Task 6: remediation orchestrator
7. Task 7: `sd-artifacts` feedback stream integration
8. Task 8: diff generation
9. Task 9: remediation plan UI
10. Task 10: apply + redeploy
11. Task 11: runtime/config rules
12. Task 12: approve/reject API surfaces
13. Task 13: history integration
14. Task 14: testing
15. Task 15: docs and rollout

## Suggested Milestones

### Milestone A: Health-aware deploys

- Tasks 1-5
- Outcome: deploys verify and monitor URL health, but no remediation yet

### Milestone B: User-approved remediation loop

- Tasks 6-10
- Outcome: failures can produce a retry plan, the user can approve it, and the system can redeploy

### Milestone C: Production hardening

- Tasks 11-15
- Outcome: broader fix coverage, history visibility, tests, and docs

## Definition of Done

Phase 2 is complete when all of the following are true:

- EC2 deploys verify application URL health before being treated as healthy
- Successful deploys are monitored for 5 minutes
- Failed verification or monitoring can create a remediation attempt
- Artifact remediation uses the `sd-artifacts` feedback stream path
- Users can approve or reject a full retry attempt
- Users can inspect a diff before approval
- Only generated artifacts and Smart Deploy-managed runtime/config are modified
- Retry count is configurable per deployment and enforced
- Remediation and monitoring outcomes are visible in history
