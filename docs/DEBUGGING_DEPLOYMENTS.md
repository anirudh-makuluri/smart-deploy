# Debugging Deployments

Use this runbook when a deploy fails or a live app looks unhealthy.

## Quick triage (5 minutes)

### 1. Ask the Deployment Agent

Open **Agent** in the header:

- "Why did my last deployment fail?"
- "Is {repo} {service} healthy right now?"

The agent lists deployments, checks history, or loads runtime health (read-only, up to 2 tool calls).

### 2. Check deployment status

In the deploy workspace **Overview**:

| Status | Meaning |
|--------|---------|
| `deploying` | Pipeline still running — watch live logs |
| `running` | Last deploy succeeded; check runtime health if URL fails |
| `failed` | Last deploy did not complete — open History |
| `degraded` / `unreachable` | Runtime health probe failing |

See [Deployment Status Reference](./DEPLOYMENT_STATUS_REFERENCE.md).

### 3. Open Deployment History

Find the latest failed entry:

1. Note **failed step** (Build, Verify, Deploy, etc.)
2. Expand step logs — find the first `❌` or `error` line
3. Note **failure code** if shown (for example `CODEBUILD_DOCKER_IMAGE_BUILD_FAILED`)

### 4. Escalate by failure type

| Failed at | Guide |
|-----------|-------|
| Build / Publish | [Build Failures](./BUILD_FAILURES.md) |
| Verify | [Health Checks](./HEALTH_CHECKS.md), [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md) |
| Deploy / Rollout | [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md) |
| URL loads but wrong behavior | Runtime logs, env vars — [Environment Variables](./ENVIRONMENT_VARIABLES.md) |
| URL does not resolve | [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md) |

### 5. Analyze failure (optional)

On a specific history entry, run **Analyze failure** for an LLM summary using full run logs.

### 6. Fix and redeploy

- Config issue → update env vars / branch / subdomain → redeploy
- Build plan issue → **Improve scan** → review blueprint → redeploy
- App code issue → fix repo → push → redeploy

## Severe production outage

If users are impacted and you need service back before root-cause analysis:

1. **Rollback** to the last successful history entry (manual, by commit)
2. Confirm URL healthy via Overview or Deployment Agent
3. Debug the failed commit separately

See [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md).

Automatic rollback failure codes exist in classification, but **manual rollback by commit** is the supported recovery path today.

## Collect evidence before asking for help

1. Exact error text from step logs
2. Repo name, service name, branch, commit SHA
3. Failure code from history (if any)
4. Whether scan build_status was passed
5. Recent config changes (env vars, subdomain)

## Related

- [Error Catalog](./ERROR_CATALOG.md)
- [Deployment Agent](./DEPLOYMENT_AGENT.md)
- [AI Assistance](./AI_ASSISTANCE.md)
- [Deployment Logs](./DEPLOYMENT_LOGS.md)