# Deployment Logs

Smart Deploy gives you three log surfaces: **live deploy logs**, **history logs**, and **ECS runtime logs**.

## Live deploy logs

During an active deploy, logs stream over WebSocket to the **Logs** tab in the deploy workspace.

| Property | Detail |
|----------|--------|
| **Transport** | WebSocket worker (`deploy:log`, `deploy:steps`) |
| **Format** | Timestamped lines grouped by deploy step |
| **Reconnection** | Subscribing to workspace replays in-progress state (`deploy:snapshot`) |

If logs stop updating:

- Check system health indicator in the header (worker offline = degraded)
- Refresh the page to reconnect WebSocket

## Deploy steps in logs

Typical step order for ECS:

```text
auth → build → publish → setup → deploy → rollout → verify → done
```

Each step shows status (`running`, `success`, `error`) and accumulated log lines. On failure, the first error line in the **failed step** is usually the root cause.

## History logs

Every deploy attempt is stored in **Deployment History**.

| Field | Content |
|-------|---------|
| `steps` | Per-step status and inline log lines |
| `failureCode` | Structured code when classified |
| `failureClassification` | Summary, likely cause, evidence |
| Full logs | Fetched from object storage via history UI (when `logRef` exists) |

Use history when the live stream is gone or you need an older attempt.

## ECS CloudWatch logs (runtime)

For **running** ECS deployments, the Logs tab can tail **CloudWatch** log group for the service (last ~50 lines).

Use for:

- App crashes after successful deploy
- Verify failures where the image built but the process exits
- Runtime exceptions not visible in deploy-step logs

Runtime logs appear after the task is running — not during CodeBuild.

## Build log excerpts (scan)

Smart Analysis stores `build_verification.log_excerpt` and `repair_history[].build_log_excerpt` in scan results. Check these when deploy fails at Build but CodeBuild logs are sparse in history.

## Reading logs effectively

1. Find the **failed step** id
2. Search for `error`, `Error`, `FAILED`, `exit code`, first npm/pip/Docker failure
3. Ignore trailing cascade errors — fix the earliest failure
4. For verify failures, scroll to ECS diagnostics appended after probe timeout

## Analyze failure

Pulls the **full** log payload for one history entry and sends it to the LLM with failure classification. Use when inline history logs are truncated.

## Agent log excerpts

The Deployment Agent returns **summarized** log lines from history (last few lines per failed step). For complete logs, open History directly.

## Related

- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Build Failures](./BUILD_FAILURES.md)
- [Deployment Agent](./DEPLOYMENT_AGENT.md)