# Error Catalog

This catalog maps common Smart Deploy errors and symptoms to likely causes and verified fixes.

How to use:
1. Match your exact error text or closest symptom.
2. Run the quick checks in order.
3. Apply the fix and retry.

---

## Common deployment failures (high frequency)

### DEPLOYMENT_FAILED_GENERIC

- Error or symptom:
  - `Deployment failed`
  - UI deploy state becomes `error`
- Likely cause:
  - Generic deploy wrapper failure with missing root-cause details in the current view
- Quick checks:
  - Inspect latest deploy step logs for first `❌` or `error` line
  - Check whether failure occurred in build, setup, or DNS step
- Fix:
  - Follow the specific mapped entries below (`CODEBUILD_DOCKER_IMAGE_BUILD_FAILED`, `EC2_CLOUD_INIT_FAILURE`, `EC2_SERVER_NOT_RESPONDING`, `VERCEL_DNS_UPDATE_FAILED`)
- Sources:
  - `src/websocket-types.ts`
  - `src/websocket-server.ts`
  - `src/custom-hooks/useWorkerWebSocket.ts`

### CODEBUILD_DOCKER_IMAGE_BUILD_FAILED

- Error or symptom:
  - `Docker image build failed. Check build logs above.`
  - `CodeBuild failed: Docker image build did not succeed`
- Likely cause:
  - Docker build failed in CodeBuild (Dockerfile/build context/dependency/auth issue)
- Quick checks:
  - Review CodeBuild logs for first failing command
  - Verify Dockerfile path and build context are correct for selected service
  - Check image pull limits/credentials (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`)
- Fix:
  - Correct build command or Dockerfile issue, then redeploy
  - Add Docker Hub credentials if logs show rate limiting
- Sources:
  - `src/lib/handleDeploy.ts`
  - `docs/AWS_SETUP.md`

### EC2_CLOUD_INIT_FAILURE

- Error or symptom:
  - `Error: Cloud-init failure detected. The deployment script failed.`
  - `Deployment failed during instance initialization (Cloud-init error). See logs for details.`
- Likely cause:
  - User-data/bootstrap script failed on EC2 during initialization
- Quick checks:
  - Inspect console output for cloud-init failures (`cloud-final`, `cloud-init failed`)
  - Check bootstrap command errors (package install, Docker startup, env parsing)
- Fix:
  - Correct failing bootstrap step and retry deploy
  - Re-run after confirming instance profile/network/package access are healthy
- Sources:
  - `src/lib/aws/handleEC2.ts`

### EC2_CLOUD_INIT_NO_COMPLETION_SIGNAL

- Error or symptom:
  - `Cloud-init finished but no deployment completion signal found. The build likely failed.`
  - `Deployment did not complete successfully. See deployment logs for Docker or build errors.`
- Likely cause:
  - Instance booted, but application build/startup did not complete
- Quick checks:
  - Check deploy logs for Docker build/runtime errors after cloud-init finished
  - Verify application start command and required env vars on instance
- Fix:
  - Fix app build/startup failure and redeploy
- Sources:
  - `src/lib/aws/handleEC2.ts`

### EC2_SERVER_NOT_RESPONDING

- Error or symptom:
  - `Deployment failed: Server is not responding. Check your application and try again.`
- Likely cause:
  - Instance came up but service health endpoint/base URL did not become reachable
- Quick checks:
  - Validate service/container is running on expected port
  - Verify security group ingress and ALB/target-group health
  - Confirm app startup did not crash after deploy
- Fix:
  - Resolve runtime or networking issue, then redeploy
- Sources:
  - `src/lib/handleDeploy.ts`

### VERCEL_DNS_UPDATE_FAILED

- Error or symptom:
  - `Vercel DNS failed: <error>` after otherwise successful deploy
- Likely cause:
  - DNS automation failed due to token/domain/team config or API permission issue
- Quick checks:
  - Verify `VERCEL_TOKEN`, `VERCEL_DOMAIN`, and optional `VERCEL_TEAM_ID`
  - Confirm domain is managed by Vercel and token has DNS permissions
- Fix:
  - Correct Vercel credentials/config and retry DNS update or add CNAME manually
- Sources:
  - `src/lib/handleDeploy.ts`
  - `docs/CUSTOM_DOMAINS.md`

### WEBSOCKET_ORIGIN_NOT_ALLOWED

- Error or symptom:
  - `Origin not allowed`
  - WebSocket/API connection rejected with 403 from worker server
- Likely cause:
  - `WS_ALLOWED_ORIGINS` does not include frontend origin
- Quick checks:
  - Compare request origin with configured allow-list
  - Ensure exact protocol + host + port match
- Fix:
  - Update `WS_ALLOWED_ORIGINS` to include frontend origin and restart worker
- Sources:
  - `src/websocket-server.ts`
  - `docs/TROUBLESHOOTING.md`

---

## Application startup and local environment

### APP_STARTUP_FAILED_LOCAL

- Error or symptom:
  - `npm run dev` fails
  - `npm run start-all` exits immediately
  - `localhost:3000` unavailable
- Likely cause:
  - Missing required environment variables
  - Dependency install is incomplete or out of sync
- Quick checks:
  - `npm install`
  - Confirm `.env` has:
    - `BETTER_AUTH_SECRET`
    - `BETTER_AUTH_URL`
    - `DATABASE_URL`
    - `SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `NEXT_PUBLIC_WS_URL`
- Fix:
  - Copy `.env.example` to `.env` and fill all required values.
  - Reinstall dependencies if needed.
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/FAQ.md`

### ENV_SUPABASE_REQUIRED_MISSING

- Error or symptom:
  - `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment`
- Likely cause:
  - Supabase env vars missing on server runtime
- Quick checks:
  - Confirm values are present and non-empty in `.env`
  - Ensure process that runs API/server has loaded env vars
- Fix:
  - Set both variables and restart the app process
- Sources:
  - `src/lib/supabaseServer.ts`
  - `docs/SUPABASE_SETUP.md`

---

## Authentication and access

### REDIRECTED_TO_WAITING_LIST

- Error or symptom:
  - Sign-in succeeds, then user lands on `/waiting-list`
- Likely cause:
  - Email not present in `approved_users`
- Quick checks:
  - Query `approved_users` for the signed-in email
- Fix:
  - Insert or upsert user email into `public.approved_users`
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/FAQ.md`

### GITHUB_NOT_CONNECTED

- Error or symptom:
  - `GitHub not connected`
  - Repo scan or deploy actions fail for non-GitHub sessions
- Likely cause:
  - Missing linked GitHub OAuth account or token
- Quick checks:
  - Confirm user signed in with GitHub or linked GitHub account
- Fix:
  - Link GitHub account and retry action
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/FAQ.md`
  - `docs/BETTER_AUTH.md`

---

## Supabase and database

### SUPABASE_DB_ENOTFOUND_OR_UNREACHABLE

- Error or symptom:
  - `getaddrinfo ENOTFOUND`
  - DB unreachable for `db.<project-ref>.supabase.co`
  - Intermittent connection timeouts
- Likely cause:
  - Using direct Supabase host on IPv4-only or constrained network
- Quick checks:
  - Inspect `DATABASE_URL` host and port
  - Confirm whether direct host is used instead of session pooler
- Fix:
  - Use Supabase Session Pooler URI for `DATABASE_URL`
- Sources:
  - `docs/SUPABASE_SETUP.md`
  - `docs/TROUBLESHOOTING.md`

### DB_RELATION_DOES_NOT_EXIST

- Error or symptom:
  - `relation does not exist`
- Likely cause:
  - `supabase/schema.sql` not executed after auth migration
- Quick checks:
  - Verify Better Auth tables exist (`user`, `session`, `account`, `verification`)
  - Verify app tables exist (`deployments`, `deployment_history`, etc.)
- Fix:
  - Run `npm run auth:migrate`
  - Execute `supabase/schema.sql` in Supabase SQL editor
- Sources:
  - `docs/SUPABASE_SETUP.md`
  - `docs/TROUBLESHOOTING.md`

### DB_FK_OWNER_ID_NOT_IN_USER

- Error or symptom:
  - FK error like `Key (owner_id)=(...) not in table "user"`
- Likely cause:
  - Legacy rows still reference old GitHub numeric owner id
- Quick checks:
  - Inspect affected rows for legacy `owner_id` values
- Fix:
  - Run `supabase/remap_legacy_owner_ids_to_better_auth.sql`
  - Remove or repair remaining orphans
- Sources:
  - `docs/SUPABASE_SETUP.md`

### SUPABASE_RLS_PERMISSION_DENIED

- Error or symptom:
  - Permission denied or RLS errors on server operations
- Likely cause:
  - Using anon key instead of service role key
- Quick checks:
  - Confirm key value belongs to `service_role`
- Fix:
  - Set `SUPABASE_SERVICE_ROLE_KEY` correctly and restart
- Sources:
  - `docs/SUPABASE_SETUP.md`

---

## WebSocket and deploy log streaming

### WEBSOCKET_NOT_CONNECTING

- Error or symptom:
  - UI status degraded
  - Deploy logs not streaming
  - Worker appears offline
- Likely cause:
  - Wrong WebSocket URL for environment
  - Worker unavailable
  - Reverse proxy missing `/ws` route
- Quick checks:
  - Dev URL: `ws://localhost:4001`
  - HTTPS URL: `wss://<domain>/ws`
  - Worker process/container is healthy
- Fix:
  - Set correct `NEXT_PUBLIC_WS_URL`
  - Ensure reverse proxy forwards `/ws` to worker
  - For split deployments, set `WS_ALLOWED_ORIGINS` to frontend origin
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/SELF_HOSTING.md`
  - `docs/FAQ.md`

---

## AWS deployment

### AWS_UNAUTHORIZED_OPERATION_RUN_INSTANCES

- Error or symptom:
  - `UnauthorizedOperation: ec2:RunInstances`
- Likely cause:
  - IAM principal missing required EC2 permissions
- Quick checks:
  - Confirm policy attached to active user/role includes EC2 actions
- Fix:
  - Attach or update IAM policy with required actions from AWS setup guide
- Sources:
  - `docs/AWS_SETUP.md`
  - `docs/TROUBLESHOOTING.md`

### AWS_EC2_CREATETAGS_DENIED

- Error or symptom:
  - `ec2:CreateTags denied`
- Likely cause:
  - IAM policy missing `ec2:CreateTags`
- Quick checks:
  - Review policy statements for EC2 action list
- Fix:
  - Add `ec2:CreateTags` permission
- Sources:
  - `docs/AWS_SETUP.md`

### AWS_ALB_CERTIFICATE_INVALID_OR_REGION_MISMATCH

- Error or symptom:
  - ALB HTTPS setup fails
  - Certificate errors around `EC2_ACM_CERTIFICATE_ARN`
- Likely cause:
  - Certificate pending/not issued or not in deployment region
- Quick checks:
  - Certificate status is `Issued`
  - ACM cert region equals `AWS_REGION`
- Fix:
  - Use issued cert in same region and redeploy
- Sources:
  - `docs/AWS_SETUP.md`
  - `docs/TROUBLESHOOTING.md`

### AWS_SSM_SENDCOMMAND_FAILURE

- Error or symptom:
  - SSM `SendCommand` failures during instance bootstrap or commands
- Likely cause:
  - Instance missing SSM agent or correct instance profile
- Quick checks:
  - Validate SSM agent installed/running
  - Validate IAM instance profile includes SSM permissions
- Fix:
  - Attach correct role and ensure agent health
- Sources:
  - `docs/AWS_SETUP.md`

### AWS_CODEBUILD_ROLE_DOES_NOT_EXIST

- Error or symptom:
  - CodeBuild fails with role creation or missing role errors
- Likely cause:
  - IAM policy missing role management actions
- Quick checks:
  - Verify IAM permissions include create/get/pass/attach role actions
- Fix:
  - Update IAM policy to include required IAM actions
- Sources:
  - `docs/AWS_SETUP.md`
  - `docs/TROUBLESHOOTING.md`

### AWS_DOCKERHUB_RATE_LIMIT_429

- Error or symptom:
  - Docker Hub 429 during CodeBuild image pull/build
- Likely cause:
  - Anonymous pull rate limit exceeded
- Quick checks:
  - Check build logs for 429 pull failures
- Fix:
  - Set `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
- Sources:
  - `docs/AWS_SETUP.md`

---

## GCP deployment

### GCP_DEPLOY_DENIED_OR_API_NOT_ENABLED

- Error or symptom:
  - Cloud Run deploy denied
  - Cloud SQL API errors
- Likely cause:
  - Required GCP APIs not enabled
  - Service account role gaps
- Quick checks:
  - Confirm required APIs are enabled:
    - `run.googleapis.com`
    - `cloudbuild.googleapis.com`
    - `artifactregistry.googleapis.com`
    - `logging.googleapis.com`
    - `sqladmin.googleapis.com` (if Cloud SQL is used)
  - Validate service account roles
- Fix:
  - Enable missing APIs and grant required roles
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/GCP_SETUP.md`

### GCP_GCLOUD_NOT_FOUND

- Error or symptom:
  - `gcloud: command not found`
- Likely cause:
  - Google Cloud CLI not installed in runner/worker environment
- Quick checks:
  - `gcloud --version`
- Fix:
  - Install Google Cloud CLI in host/image
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/GCP_SETUP.md`

---

## Domains, TLS, and self-hosting runtime

### CUSTOM_DOMAIN_NOT_RESOLVING_OR_TLS_FAILED

- Error or symptom:
  - Domain does not load
  - DNS record missing
  - HTTPS/TLS errors
- Likely cause:
  - Missing or incorrect DNS records
  - Vercel or certificate variables not configured
- Quick checks:
  - `NEXT_PUBLIC_DEPLOYMENT_DOMAIN` present
  - If Vercel-managed DNS: `VERCEL_TOKEN` and `VERCEL_DOMAIN` set
  - AWS HTTPS: certificate ARN valid and issued
- Fix:
  - Correct DNS records, wait for propagation, redeploy after cert is valid
- Sources:
  - `docs/TROUBLESHOOTING.md`
  - `docs/CUSTOM_DOMAINS.md`

### SELF_HOST_BUILD_OOM

- Error or symptom:
  - Docker or Next.js build is killed on small instances
- Likely cause:
  - Insufficient memory during build
- Quick checks:
  - Instance size and available RAM/swap
- Fix:
  - Run `sudo ./scripts/setup-swap.sh`
  - Set `NODE_MAX_OLD_SPACE_SIZE` in `.env` (for example `2048` or `4096`)
- Sources:
  - `docs/SELF_HOSTING.md`
  - `docs/TROUBLESHOOTING.md`

### NGINX_502_BAD_GATEWAY

- Error or symptom:
  - Nginx returns 502
- Likely cause:
  - App containers are still booting
  - Upstream app failed due to env/config issues
- Quick checks:
  - `docker compose ps`
  - `docker compose logs`
- Fix:
  - Wait for startup completion
  - Fix env/config issues and restart services
- Sources:
  - `docs/SELF_HOSTING.md`
  - `docs/TROUBLESHOOTING.md`

---

## Notes for retrieval quality

- Keep each error entry stable and append-only where possible.
- Prefer exact error text in entries (quoted strings) to improve matching.
- When adding new incidents, include:
  - exact message
  - environment (local, AWS, GCP, self-hosted)
  - root cause
  - verified fix
  - source file reference
