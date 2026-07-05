# Deployment Pipeline

Every deploy follows the same high-level stages. The blueprint shows them before you ship; the deploy workspace streams them live.

## Execution path

Before pipeline stages begin, Smart Deploy routes the run through a queue and isolated executor:

```text
Deploy button
  → WebSocket worker creates deployment run
  → SQS FIFO message (runId, userId, repoName, serviceName)
  → Lambda handler
  → ECS RunTask (deployment-runner.js)
  → pipeline stages below
  → live logs relayed to WebSocket worker → UI
```

- **FIFO ordering** — at most one active deploy per user/repo/service; later deploys wait in queue.
- **Deduplication** — message dedup ID is the `runId`, so retries do not double-start the same run.
- **Isolation** — each run gets its own Fargate task; the WebSocket EC2 host does not run the pipeline.

Self-hosting setup: [`infra/smart-deploy-platform`](../infra/smart-deploy-platform/README.md).

## Pipeline stages

| Stage | What happens |
|-------|--------------|
| **Queue** | Run recorded in the database and enqueued; Lambda waits for prior runs on the same service to finish |
| **Launch** | Lambda starts the ECS deployment runner task with `DEPLOYMENT_RUN_ID` |
| **Auth** | Resolve GitHub access, branch, and commit SHA |
| **Build** | CodeBuild clones the repo and builds the artifact |
| **Publish** | Push image to ECR (containers) or sync to S3 (static) |
| **Setup** | Region, ECS service/task, or static bucket configuration |
| **Deploy** | Roll out the release, configure ALB host rules, apply secrets |
| **Rollout** | Wait for ECS tasks to become running (container path) |
| **Verify** | HTTP probes until the app responds healthy or timeout |
| **Done** | Hosted URL is live; status updates to running or failed |

## Container path (ECS Fargate)

Used for server apps, Railpack-built containers, and repos with an existing Dockerfile.

```text
GitHub repo @ commit
  → CodeBuild (Railpack plan or Dockerfile)
  → ECR image
  → ECS Fargate task
  → shared ALB + host rule
  → Route 53 subdomain
  → verification probes
  → https://{subdomain}.{domain}
```

**Build input**: Railpack plan JSON (`docker buildx build -f /tmp/railpack-plan.json`) or repo `Dockerfile`.

**Runtime**: ECS task uses Railpack `deploy.startCommand` or the image default `CMD`.

See [Railpack](./RAILPACK.md).

## Static path (S3)

Used for plain static files or build-only SPAs without a runtime start command.

```text
GitHub repo @ commit
  → CodeBuild (static build)
  → S3 prefix sync
  → optional CloudFront invalidation
  → public base URL
```

**Routing rule**: `deploy_shape: static`, or `static_build` where Railpack has no `deploy.startCommand`.

## What Smart Deploy provisions

| Resource | Container | Static |
|----------|-----------|--------|
| CodeBuild project | Yes | Yes |
| ECR repository | Yes | No |
| ECS cluster/service | Yes | No |
| ALB host rule | Yes | No |
| Route 53 record | Yes (wildcard + host rule) | Per-subdomain when needed |
| S3 prefix | No | Yes |
| Secrets Manager | Runtime env (ECS) | No |

## Editable before deploy

From blueprint preview or config tabs:

- **Branch** — defaults to repo default branch if blank
- **AWS region** — where resources are created
- **Env vars** — build-time in CodeBuild; runtime via Secrets Manager on ECS
- **Hosted subdomain** — `https://{subdomain}.{deployment-domain}`

Changing env vars after a successful deploy typically requires a **redeploy** for runtime values to take effect on ECS.

## Verification

After rollout, Smart Deploy probes your URL for up to roughly five minutes:

- Paths tried: `/`, `/health`, `/healthz`, `/api/health`
- Success: HTTP 2xx or 3xx
- Failure: deploy marked failed with `DEPLOYMENT_VERIFICATION_FAILED`

See [Health Checks](./HEALTH_CHECKS.md).

## Failure stages

Failures are classified by stage: `clone`, `auth`, `build`, `publish`, `setup`, `deploy`, `rollout`, `verify`, `rollback`.

See [Deployment Status Reference](./DEPLOYMENT_STATUS_REFERENCE.md) and [Error Catalog](./ERROR_CATALOG.md).

## Related

- [Blueprint and Preview](./BLUEPRINT_AND_PREVIEW.md)
- [Build Failures](./BUILD_FAILURES.md)
- [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)