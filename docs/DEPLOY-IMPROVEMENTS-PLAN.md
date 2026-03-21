# Deploy improvements plan

Reference plan for future work on deploy failure handling, health checks, and automation. Use this doc when implementing these features.

---

## 1. Prerequisites (do first)

- **Shared Docker generator**  
  Extract/centralize Dockerfile and docker-compose generation into a shared `dockerGenerator.ts` (or similar) so all platforms use the same logic.

- **Log sanitization and encoding**  
  - Use a shared `sanitizeLogText` (or equivalent) for all log output.  
  - Fix encoding issues (e.g. Windows charmaps, codec errors) so logs are safe to store and display.

- **Per-log timestamps**  
  - Store deploy step logs with timestamps so the UI can show “when” each line appeared.  
  - Example: change `DeployStep.logs` from `string[]` to `Array<{ text: string; timestamp: number }>` (or ISO string).

---

## 2. Failure analyzer

- After a deploy fails, run an analyzer over:
  - Build logs
  - Runtime/console logs (e.g. EC2 get-console-output, ECS/Cloud Run logs)
  - Exit codes and error messages
- Output a short, structured summary (e.g. “Build failed: missing env X”, “Container exited: OOM”, “SSM not registered”) that can be used for:
  - Showing a “Why it failed” section in the UI
  - Creating a GitHub issue (see below)
  - Deciding whether to try an automatic fix (see below)

---

## 3. GitHub issue creation

- When a deploy fails, optionally create a GitHub issue in the same repo with:
  - Title derived from the failure (e.g. “Deploy failed: [reason]”)
  - Body: failure summary from the analyzer, relevant log snippets, link to the deploy in SmartDeploy, and timestamp.

---

## 4. Optional fix-and-retry

- For certain failure types (e.g. “SSM not registered”, “missing env”), implement optional automatic fixes (e.g. reboot instance, add env, retry SSM).
- After applying a fix, optionally trigger a single retry of the deploy and report success/failure again.

---

## 5. Post-deploy health check

- After a successful deploy (e.g. EC2 user-data reports “Deployment complete!”), call a **post-deploy health check**:
  - e.g. `checkDeployHealth(baseUrl)` that:
    - GETs the deployment URL (or a health path if configured).
    - Treats **5xx** or an **error-page body** (e.g. nginx 502/503 page, generic error HTML) as failure.
- If the health check fails, treat the overall deploy as failed (or “deployed but unhealthy”) and surface that in the UI and, if implemented, in the failure analyzer / GitHub issue.

---

## 6. Webhook for auto-deploy on merge to main

- Add support for a **webhook** that external systems (e.g. GitHub Actions or GitHub webhook) can call to trigger a deploy.
- Typical use: on push/merge to `main`, call the webhook so SmartDeploy runs a deploy for that repo/branch without manual “Deploy” click.
- Requires: secure token or signature verification, mapping webhook payload to project/branch, and idempotency or “last deploy” semantics so repeated webhook calls don’t spawn duplicate deploys.

---

## Implementation order (suggested)

1. Prerequisites (docker generator, sanitizeLogText, per-log timestamps).  
2. Post-deploy health check (`checkDeployHealth`).  
3. Failure analyzer (structured summary from logs).  
4. GitHub issue creation (using analyzer output).  
5. Optional fix-and-retry for known failure types.  
6. Webhook for auto-deploy on merge to main.

---

*This plan was captured from earlier discussion and can be updated as features are implemented or priorities change.*
