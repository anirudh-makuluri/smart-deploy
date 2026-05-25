# Phase 2 Operations

Phase 2 turns Smart Deploy into an EC2-first remediation agent with user approval.

It does not change the core promise:
- infra artifacts still come from `sd-artifacts`
- deploy logs still stream live
- the user still approves the retry attempt before Smart Deploy applies it

## What Phase 2 Does

After an EC2 deployment:
1. Smart Deploy verifies the live URL.
2. If verification fails, it creates a remediation attempt.
3. The user sees a human-readable plan and an optional diff preview.
4. If approved, Smart Deploy routes artifact fixes through `/api/feedback/stream`, applies any allowed runtime config changes, and redeploys.
5. If the deploy succeeds, Smart Deploy monitors the URL for 5 minutes.
6. If the app becomes unhealthy during monitoring, Smart Deploy proposes the next retry attempt.

## What Phase 2 Can Change

Allowed surfaces:
- generated `Dockerfile` content
- generated `docker-compose.yml`
- generated `nginx.conf`
- Smart Deploy-managed runtime config such as `envVars`

Not allowed in Phase 2:
- application source code
- GitHub repo edits
- pull requests
- Cloud Run remediation

## Retry Semantics

- Retry approval is per attempt, not per file.
- `maxAutoFixRetries` is configured per deployment.
- When the retry limit is reached, Smart Deploy stops proposing new retries for that deployment session.
- Retry exhaustion is visible in deployment history and logs.

Recommended defaults:
- `maxAutoFixRetries=2`
- `healthMonitoringWindowSec=300`

## Global Rollout Guardrail

Use this environment variable to disable Phase 2 auto-fix by default across the app:

```bash
NEXT_PUBLIC_SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT=false
```

Server-side code also honors:

```bash
SMARTDEPLOY_PHASE2_AUTOFIX_DEFAULT=false
```

Behavior:
- if the flag is unset, Phase 2 auto-fix stays enabled by default
- if the flag is `false`, new deployments default to `autoFixEnabled=false`
- any deployment record that already has `autoFixEnabled` explicitly set keeps its own value

## Operator Checklist

Before enabling Phase 2 broadly:
- confirm `/api/feedback/stream` is healthy
- confirm EC2 deploy verification is passing for known-good apps
- confirm deployment history shows remediation attempts and monitoring results
- confirm retry limits are set to a low value for first rollout

When investigating a bad retry loop:
- review `deployment_history`
- review `deployment_remediation_attempts`
- review `deployment_health_checks`
- confirm whether the failure came from initial deploy verification or post-success monitoring

## Failure Modes To Expect

- Missing commit SHA prevents artifact remediation from starting.
- Low-confidence failures may only produce artifact-regeneration suggestions.
- Retry exhaustion means Smart Deploy has stopped and is waiting for manual intervention.
- Rejected remediation attempts are terminal for that deployment session until the user deploys again.
