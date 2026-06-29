# AI Assistance

Smart Deploy includes AI features to speed up production debugging. Each has a different data source and scope.

## Feature comparison

| Feature | Where | Data source | Best for |
|---------|-------|-------------|----------|
| **Deployment Agent** | Header → Agent | Live DB + runtime health via tools | Quick triage: list deploys, check health, recent failures |
| **Analyze failure** | History / Logs | Full run logs + failure classification | Deep dive on one failed deploy attempt |
| **Improve scan** | Scan results | SD Artifacts feedback stream | Fix Railpack plan or build after scan/verification failure |

## Recommended debugging flow

```text
1. Deployment Agent     →  "Why did my last deployment fail?"
2. Deployment History   →  full step logs for the failed run
3. Analyze failure      →  LLM explanation using complete logs
4. Improve scan         →  if build/plan issue (re-scan before redeploy)
5. Targeted guide       →  Build Failures, Health Checks, etc.
```

## Deployment Agent

Read-only inspector. Uses up to 2 tool calls per question.

- ✅ "Show my deployments", "is api healthy?", "what failed last time?"
- ❌ Cannot deploy, rollback, or edit config

See [Deployment Agent](./DEPLOYMENT_AGENT.md).

## Analyze failure

Runs on a **specific deployment history entry**. Sends:

- Failure code and classification
- Step summary
- Full logs from object storage (when available)

Use when the agent's log excerpts are not enough or you need a narrative root-cause analysis.

Available from:

- **Deployment History** — on a failed entry
- **Deploy Logs** — during or after a failed deploy

## Improve scan

Sends failure context back to SD Artifacts to regenerate or repair the Railpack plan.

Use when:

- Build verification failed
- Railpack plan looks wrong
- Deploy failed at Build with dependency or Dockerfile issues tied to scan output

Always review the updated scan and blueprint before redeploying.

## Choosing the right tool

| Situation | Start with |
|-----------|------------|
| "Is my app down?" | Deployment Agent → Runtime Health tab |
| "Deploy failed 5 minutes ago" | Deployment Agent → History → Analyze failure |
| "Build failed in CodeBuild" | History logs → [Build Failures](./BUILD_FAILURES.md) → Improve scan if plan-related |
| "Wrong Node version" | [Railpack](./RAILPACK.md) → Improve scan if auto-detection failed |

## Related

- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Deployment Logs](./DEPLOYMENT_LOGS.md)
- [Smart Analysis](./SMART_ANALYSIS.md)