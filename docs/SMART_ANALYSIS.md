# Smart Analysis

**Smart Analysis** is the repo scan that runs before you deploy. It detects how your app should be built, generates Railpack plans (or recognizes a Dockerfile), and optionally verifies the build.

## When to run it

- First time deploying a service
- After significant repo changes (new framework, Dockerfile, monorepo layout)
- When a deploy failed due to build or scan issues — then use **Improve scan** with failure context

Re-scanning updates `scanResults` linked to your deployment and refreshes the blueprint.

## Scan progress nodes

| Node | Description |
|------|-------------|
| **Scanner** | Resolve commit and repo scope |
| **Clone repo** | Check out repository at commit |
| **Classifier** | Detect deploy shape and deploy units |
| **Railpack prepare** | Generate Railpack build plan per unit |
| **Deploy briefing** | Operator summary (markdown) |
| **Build and repair** | Verify build; AI repair loop when enabled |
| **Finalize** | Schema version and final build status |

Watch scan logs in the UI for the first `❌` or error line if a node fails.

## Deploy shapes

| Shape | Meaning |
|-------|---------|
| `static` | Plain static files, no build step |
| `static_build` | SPA or static site with a build step |
| `server` | Server app built and run as a container |
| `multi` | Multiple deploy units (compose-style) |
| `existing_docker` | Uses repo Dockerfile instead of Railpack |

Deploy routing uses shape plus Railpack `deploy.startCommand` to choose ECS vs S3. See [How It Works](./HOW_IT_WORKS.md).

## Scan result fields

Key fields in the stored analysis response:

| Field | Purpose |
|-------|---------|
| `deploy_units[]` | Name, root, type, framework, port, `railpack_plan` |
| `build_status` | `passed`, `failed`, `skipped`, etc. |
| `build_verification` | Verification attempt logs and message |
| `repair_history[]` | AI repair attempts if build failed initially |
| `deploy_briefing` | Human-readable scan summary |
| `railpack_version` | Railpack version used for the plan |

## Build verification

When enabled, SD Artifacts runs a test build after plan generation. Outcomes:

- **Passed** — safer to deploy; blueprint shows green build status
- **Failed** — review `build_verification.log_excerpt` and `repair_history`
- **Skipped** — verification not run for this scan

Use **Improve scan** to send failure logs back to SD Artifacts for remediation.

## Improve scan (feedback)

After a failed deploy or failed verification:

1. Open Improve scan from scan results
2. Add context about what failed
3. SD Artifacts re-analyzes with your failure evidence
4. Review updated plan before redeploying

## Package path (monorepos)

Scans are scoped to a **package path** per service (for example `apps/web`). The classifier and Railpack prepare run in that scope while still understanding repo layout.

See [Monorepos and Multi-Service](./MONOREPOS_AND_MULTI_SERVICE.md).

## Related

- [Railpack](./RAILPACK.md)
- [Build Failures](./BUILD_FAILURES.md)
- [Blueprint and Preview](./BLUEPRINT_AND_PREVIEW.md)