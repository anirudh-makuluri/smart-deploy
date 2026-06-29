# Deployment History and Rollback

Every deploy attempt is recorded. Use history to audit changes, compare failures, and roll back to a known-good commit.

## History entries

Each entry includes:

| Field | Description |
|-------|-------------|
| **timestamp** | When the attempt started |
| **success** | Whether the pipeline completed healthy |
| **branch / commitSha** | Git ref that was deployed |
| **duration** | Wall-clock time for the attempt |
| **steps** | Per-step status and logs |
| **failureCode** | Structured code when failed (see [Status Reference](./DEPLOYMENT_STATUS_REFERENCE.md)) |
| **failureClassification** | Summary, likely cause, evidence |
| **release_artifact** | ECR image URI/digest or S3 path for reproducibility |

## Viewing history

Open the **History** tab in the deploy workspace. Failed entries highlight the failed step and show failure code when classified.

Use **Analyze failure** on an entry for LLM analysis with full logs.

## Manual rollback

Rollback redeploys a **previous commit SHA** from a successful history entry.

### What rollback restores

| Restored | Kept from current config |
|----------|--------------------------|
| Commit SHA (and thus built artifact for that commit) | Current env vars |
| Branch context from selected entry | Current subdomain, region |

Rollback is a **new deploy attempt** using the old commit — not an instant ALB pointer swap.

### How to roll back

1. Open **History**
2. Select a **successful** entry before the bad deploy
3. Confirm rollback
4. Wait for pipeline to complete and verify health

### Rollback limitations

- Fails with `MANUAL_ROLLBACK_FAILED` if artifact metadata is missing or redeploy errors
- Automatic rollback codes exist in classification but **automatic rollback is not implemented** in the deploy handler today
- Pause/resume are not supported on AWS — only delete or redeploy

## Release artifacts

Successful deploys store `release_artifact` metadata:

- **ECS**: ECR image URI and digest
- **Static**: S3 bucket and prefix

Used for rollback context and reproducibility. If missing, rollback may not reconstruct the prior release.

## Comparing attempts

When debugging regressions:

1. Compare failed entry to last successful entry
2. Diff commit messages and SHAs
3. Check if env vars changed between attempts (rollback keeps current env)
4. Review whether scan `build_status` changed after Improve scan

## Related

- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Deployment Logs](./DEPLOYMENT_LOGS.md)
- [Deployment Agent](./DEPLOYMENT_AGENT.md)