# Runtime Health

After a successful deploy, Smart Deploy tracks **runtime health** — whether your app stays reachable and ECS/ALB signals look normal.

## Where to see it

- **Overview** tab — status badge and health sparkline
- **Deployment Agent** — "Is my service healthy right now?" uses `get_runtime_health`

## Health states

| Status | Meaning |
|--------|---------|
| **healthy** | App probe succeeded; ECS/ALB signals nominal |
| **degraded** | Partial failure — for example app up but ALB targets unhealthy |
| **unreachable** | HTTP probe failed or ECS desired ≠ running |
| **unknown** | Not enough recent samples or deployment not running |

Statuses use **anti-flap** logic — brief blips do not immediately flip `running` to `unreachable`.

## What gets probed

Each reconciliation cycle (~10 minutes) collects:

| Signal | Source |
|--------|--------|
| **App HTTP** | GET to deployment URL (same paths as verify) |
| **ECS** | Desired vs running task count, rollout state |
| **ALB** | Healthy vs unhealthy target count |

Samples are stored in runtime health history and exposed via API for charts and the Deployment Agent.

## Deploy status vs runtime health

| Field | When set |
|-------|----------|
| Deployment `status: running` | Last **deploy** succeeded |
| Runtime `degraded` / `unreachable` | **Ongoing** probes failing after deploy |

A deployment can show `running` while runtime health is `degraded` — the release deployed but the app is misbehaving now.

## Debugging degraded health

1. Open **Logs** → ECS CloudWatch tail
2. Ask Deployment Agent for runtime health entries (HTTP code, latency)
3. Check recent deploy or config change in History
4. Follow [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)

## ECS-specific signals

| Signal | Interpretation |
|--------|----------------|
| `running < desired` | Tasks crashing or failing health checks |
| `rolloutState: FAILED` | ECS deployment circuit breaker or failed rollout |
| Unhealthy ALB targets | Port mismatch, app not listening on `PORT`, or slow startup |

## Related

- [Health Checks](./HEALTH_CHECKS.md)
- [Deployment Agent](./DEPLOYMENT_AGENT.md)
- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)