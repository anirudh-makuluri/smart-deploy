# Error Catalog

Symptom-first reference for deployment and runtime issues. Match your error text, run quick checks, apply the fix.

**Agent retrieval notes:** Each entry includes exact strings, `stage`, `retryable`, and `agent_signals` for automated matching.

---

## How to use

1. Match exact error text or closest symptom
2. Run quick checks in order
3. Apply fix and redeploy
4. Escalate via [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md) or [Deployment Agent](./DEPLOYMENT_AGENT.md)

---

## Deployment failure codes

### DEPLOYMENT_FAILED_GENERIC

- **Stage:** unknown
- **Retryable:** no
- **Exact strings:** `Deployment failed`
- **Symptoms:** Deploy ends in `failed` without a specific code in UI
- **Likely cause:** Wrapper failure — root cause is in step logs
- **Quick checks:**
  1. Deployment History → first step with `error` status
  2. First `❌` or `error` line in that step's logs
  3. Map to a specific code below
- **Fix:** Address the underlying step failure; redeploy
- **Related:** [Deployment Logs](./DEPLOYMENT_LOGS.md)
- **Agent signals:** `failed`, `error`, `step logs`

### CODEBUILD_DOCKER_IMAGE_BUILD_FAILED

- **Stage:** build
- **Retryable:** no
- **Exact strings:**
  - `Docker image build failed. Check build logs above.`
  - `CodeBuild failed: Docker image build did not succeed`
- **Symptoms:** Pipeline stops at Build; `failed` status
- **Likely cause:** Railpack/Dockerfile build failed — deps, version, context
- **Quick checks:**
  1. Build step logs for first failing npm/pip/docker command
  2. Scan `build_status` — did verification pass?
  3. Correct package path for monorepo service?
- **Fix:** Fix Dockerfile/plan/deps; Improve scan if plan wrong; redeploy
- **Related:** [Build Failures](./BUILD_FAILURES.md), [Railpack](./RAILPACK.md)
- **Agent signals:** `build`, `CodeBuild`, `Dockerfile`, `Railpack`, `npm`, `pip`

### DEPLOYMENT_VERIFICATION_FAILED

- **Stage:** verify
- **Retryable:** no
- **Exact strings:** `Deployment verification failed`, health probe timeout messages
- **Symptoms:** Build/deploy succeed; Verify step fails; URL unhealthy
- **Likely cause:** App not listening on PORT, crash on start, no 2xx on probed paths
- **Quick checks:**
  1. Verify step logs and ECS diagnostics
  2. CloudWatch runtime logs for crash stack trace
  3. App binds `0.0.0.0` and `PORT`
  4. `/health` returns 200
- **Fix:** Fix startup/port/env; redeploy
- **Related:** [Health Checks](./HEALTH_CHECKS.md), [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)
- **Agent signals:** `verify`, `health`, `502`, `503`, `unreachable`

### AUTHENTICATION_FAILED

- **Stage:** auth
- **Retryable:** no
- **Exact strings:** `unauthorized`, `GitHub not connected`, `access denied`, `invalid token`
- **Symptoms:** Early pipeline failure at auth or clone
- **Likely cause:** GitHub token expired or cloud credentials invalid
- **Quick checks:**
  1. Re-link GitHub account
  2. Retry deploy after fresh sign-in
- **Fix:** Restore GitHub connection; retry
- **Related:** [FAQ](./FAQ.md)
- **Agent signals:** `auth`, `GitHub`, `token`, `unauthorized`

### INFRASTRUCTURE_NETWORK_FAILURE

- **Stage:** deploy
- **Retryable:** yes
- **Exact strings:** `ECONNREFUSED`, `timed out`, `ENOTFOUND`, `socket hang up`
- **Symptoms:** Intermittent deploy failure mid-pipeline
- **Likely cause:** Transient AWS or network reachability
- **Quick checks:**
  1. Retry deploy
  2. If persistent, check AWS service health
- **Fix:** Retry; contact operator if repeated
- **Agent signals:** `timeout`, `network`, `ECONNREFUSED`

### MANUAL_ROLLBACK_FAILED

- **Stage:** rollback
- **Retryable:** no
- **Exact strings:** `Rollback failed`, `could not restore the selected release`
- **Symptoms:** Rollback action errors in UI
- **Likely cause:** Missing release artifact or redeploy of old commit failed
- **Quick checks:**
  1. Select a different successful history entry
  2. Confirm entry has commit SHA and success=true
- **Fix:** Pick another rollback target or fix forward with new deploy
- **Related:** [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md)
- **Agent signals:** `rollback`, `restore`, `artifact`

### AUTOMATIC_ROLLBACK_FAILED / AUTOMATIC_ROLLBACK_NO_CANDIDATE

- **Stage:** rollback
- **Retryable:** no
- **Note:** Classification codes exist; automatic rollback is not active in deploy handler. Treat as verify failure and use manual rollback.
- **Related:** [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md)

---

## Runtime symptoms (no deploy failure)

### APP_RETURNS_502_503

- **Stage:** verify / runtime
- **Retryable:** no
- **Symptoms:** URL loads but ALB returns 502 or 503
- **Likely cause:** ECS tasks unhealthy or not listening on correct port
- **Quick checks:**
  1. Runtime health in Overview
  2. CloudWatch logs
  3. `PORT` and bind address
- **Fix:** [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)
- **Agent signals:** `502`, `503`, `unhealthy`, `ALB`

### RUNTIME_DEGRADED

- **Stage:** runtime
- **Symptoms:** Status `running` but health `degraded`
- **Likely cause:** Partial infrastructure or app probe failure
- **Quick checks:** Deployment Agent → runtime health; ECS vs ALB signals
- **Fix:** [Runtime Health](./RUNTIME_HEALTH.md)
- **Agent signals:** `degraded`, `health`, `ECS`, `ALB`

---

## Scan and build verification

### SCAN_BUILD_VERIFICATION_FAILED

- **Stage:** build (scan)
- **Symptoms:** Smart Analysis completes with `build_status: failed`
- **Likely cause:** Railpack plan does not build at scanned commit
- **Quick checks:** `build_verification.log_excerpt`, `repair_history`
- **Fix:** Improve scan; fix repo; re-scan before deploy
- **Related:** [Smart Analysis](./SMART_ANALYSIS.md), [Build Failures](./BUILD_FAILURES.md)
- **Agent signals:** `scan`, `verification`, `repair`, `Railpack`

### MISSING_RAILPACK_PLAN

- **Stage:** build (preview)
- **Exact strings:** `Missing Railpack plan for`
- **Symptoms:** Blueprint warning; deploy may fail at buildspec generation
- **Likely cause:** Scan incomplete or wrong service path
- **Fix:** Re-run Smart Analysis on correct service
- **Related:** [Railpack](./RAILPACK.md)

---

## GitHub and access

### GITHUB_NOT_CONNECTED

- **Exact strings:** `GitHub not connected`
- **Symptoms:** Scan or deploy actions blocked
- **Fix:** Sign in with GitHub or link GitHub account
- **Agent signals:** `GitHub`, `connected`, `OAuth`

### REDIRECTED_TO_WAITING_LIST

- **Symptoms:** Sign-in succeeds then `/waiting-list`
- **Likely cause:** Email not approved on this instance
- **Fix:** Request access from platform operator
- **Agent signals:** `waiting list`, `approved`

---

## Domain and DNS

### CUSTOM_DOMAIN_NOT_RESOLVING

- **Symptoms:** Visit URL does not resolve or wrong site
- **Quick checks:**
  1. Subdomain spelling in config
  2. `dig` / `nslookup` for hostname
  3. Redeploy after subdomain change
- **Fix:** [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md)
- **Agent signals:** `DNS`, `domain`, `resolve`, `TLS`

---

## Deployment Agent

### DEPLOYMENT_AGENT_OFFLINE

- **Exact strings:** `The deployment agent is offline right now`
- **Symptoms:** Agent button returns immediately with offline message
- **Likely cause:** WebSocket worker disconnected
- **Quick checks:** System health indicator in header
- **Fix:** Refresh page; wait for worker recovery
- **Agent signals:** `agent offline`, `WebSocket`, `worker`

### DEPLOYMENT_AGENT_TOOL_LIMIT

- **Exact strings:** `couldn't finish the inspection within the current tool-call limit`
- **Symptoms:** Agent stops after partial answer
- **Fix:** Ask narrower question; use History + Analyze failure
- **Related:** [Deployment Agent](./DEPLOYMENT_AGENT.md)
- **Agent signals:** `tool limit`, `inspection`

---

## Docker registry

### DOCKERHUB_RATE_LIMIT_429

- **Exact strings:** `429`, `toomanyrequests`, rate limit in CodeBuild logs
- **Symptoms:** Build fails pulling base images
- **Fix:** Retry later; use authenticated registry pulls
- **Related:** [Build Failures](./BUILD_FAILURES.md)
- **Agent signals:** `429`, `Docker Hub`, `rate limit`

---

## Notes for retrieval quality

- Prefer exact quoted error strings in search indexes
- Tag entries with `user_facing: true` and `stage`
- Append new incidents; avoid renaming stable codes
- Cross-link to deep guides for fixes