# Deployment Agent

The **Deployment Agent** is a read-only AI inspector for your live deployments. Open it from the header **Agent** button.

It answers questions by fetching **your** deployment data — status, history, health — through tools, and can pull **platform docs** (via Moss search) when troubleshooting guidance is needed. It does not guess repos, services, or health states.

## What it can do

| Capability | Example questions |
|------------|-------------------|
| List deployments | "Show me my deployments" |
| Inspect current state | "What's the status of my api service?" |
| Review history | "Why did my last deployment fail?" |
| Check health | "Is my service healthy right now?" |
| Search platform docs | "What does an ALB unhealthy target mean?" (often paired with a deployment tool) |

## What it cannot do

The agent is **read-only**. It cannot:

- Trigger deploys or rollbacks
- Change env vars, branch, or subdomain
- Re-run Smart Analysis or Improve scan
- Access another user's deployments

For actions, use the deploy workspace UI.

## How to ask effective questions

**Use repo and service names from your dashboard:**

| You say | Agent uses |
|---------|------------|
| `acme/smart-deploy` | `repoName: smart-deploy` |
| service `web` | `serviceName: web` |

**Good prompts:**

- "Show me my deployments"
- "Why did smart-deploy web fail on the last deploy?"
- "Is shop-api healthy right now?"

**Ambiguous prompts:** If you mention only `api` without a repo, the agent lists deployments first instead of guessing.

## Tools the agent uses

| Tool | Returns |
|------|---------|
| `list_deployments` | Up to 25 deployments: status, branch, target, URL |
| `get_deployment_details` | Status, commit, revision, region, cloud resources, scan summary |
| `get_deployment_history` | Recent attempts: success/fail, failed step, log excerpts |
| `get_runtime_health` | Recent probes: app status, HTTP code, latency, ECS/ALB signals |
| `search_docs` | Relevant Smart Deploy doc excerpts (Moss + deterministic search) for troubleshooting and how-to |

## Live status updates

While working, the agent streams progress:

- Accepted → status updates → tool started/completed → final message

If the WebSocket worker is offline, you see: *"The deployment agent is offline right now. Refresh the page and try again."*

## Limits

| Limit | Value |
|-------|-------|
| Tool calls per question | 2 |
| Conversation memory | Last 6 turns |
| History/health samples per tool | 5 |
| Write actions | None |

Complex root-cause analysis may hit the tool limit. Use **Analyze failure** on a specific history entry or read full logs in the History tab.

## Starter prompts

Built-in shortcuts in the agent sheet:

1. Show me my deployments
2. Why did my last deployment fail?
3. Is my service healthy right now?

## When to escalate

| Need | Use instead |
|------|-------------|
| Full step logs | Deployment History tab |
| Deep failure analysis | Analyze failure on a history entry |
| Fix build plan | Improve scan |
| Platform how-to | [FAQ](./FAQ.md), [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md) |

See [AI Assistance](./AI_ASSISTANCE.md).

## Related

- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Runtime Health](./RUNTIME_HEALTH.md)
- [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md)