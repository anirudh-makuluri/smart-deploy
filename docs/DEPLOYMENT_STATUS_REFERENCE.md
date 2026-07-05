# Deployment Status Reference

Vocabulary for deployment status, failure stages, categories, and codes.

## Deployment status

| Status | Meaning |
|--------|---------|
| `pending` | Created, never deployed |
| `deploying` | Pipeline in progress |
| `running` | Last deploy succeeded |
| `failed` | Last deploy failed |
| `degraded` | Running but runtime health degraded |
| `unreachable` | Running but probes failing |
| `paused` | UI state; AWS pause not fully supported |

## Deployment run status

Each deploy attempt (a **run**) has its own lifecycle:

| Status | Meaning |
|--------|---------|
| `queued` | Run created and enqueued on SQS; waiting for Lambda to launch the ECS task |
| `deploying` | ECS deployment runner is executing the pipeline |
| `completed` | Run finished (success or failure recorded in history) |

## Runtime health status

| Status | Meaning |
|--------|---------|
| `healthy` | App and infrastructure signals OK |
| `degraded` | Partial failure (for example ALB targets unhealthy) |
| `unreachable` | HTTP probe or ECS counts indicate outage |
| `unknown` | Insufficient recent samples |

## Failure stages

| Stage | Typical failure point |
|-------|----------------------|
| `clone` | Git checkout |
| `detect` | Service/scan detection |
| `auth` | GitHub or cloud credentials |
| `build` | CodeBuild / Railpack / Docker |
| `publish` | ECR push or S3 sync |
| `setup` | Infrastructure preparation |
| `deploy` | ECS service update |
| `rollout` | Waiting for tasks |
| `verify` | HTTP health probes |
| `rollback` | Rollback attempt |
| `unknown` | Unclassified |

## Failure categories

| Category | Description |
|----------|-------------|
| `auth_failure` | Credential or permission problem |
| `build_failure` | Image or artifact build failed |
| `startup_failure` | Process failed to start (often overlaps verify) |
| `health_check_failure` | Verification probes failed |
| `rollback_failure` | Rollback could not complete |
| `infrastructure_failure` | Transient network or cloud reachability |
| `unknown_failure` | No pattern matched |

## Failure codes

| Code | Summary | Retryable |
|------|---------|-----------|
| `AUTHENTICATION_FAILED` | GitHub, cloud, or registry auth failed | No |
| `CODEBUILD_DOCKER_IMAGE_BUILD_FAILED` | CodeBuild image build failed | No |
| `DEPLOYMENT_VERIFICATION_FAILED` | Post-deploy health check failed | No |
| `AUTOMATIC_ROLLBACK_FAILED` | Verify failed and auto-rollback failed | No |
| `AUTOMATIC_ROLLBACK_NO_CANDIDATE` | No prior release to restore | No |
| `MANUAL_ROLLBACK_FAILED` | User rollback failed | No |
| `INFRASTRUCTURE_NETWORK_FAILURE` | Transient network issue | Yes |
| `DEPLOYMENT_FAILED_GENERIC` | Unclassified — check step logs | No |

Detailed symptoms and fixes: [Error Catalog](./ERROR_CATALOG.md).

## Scan build status

| Value | Meaning |
|-------|---------|
| `passed` | Build verification succeeded |
| `failed` | Verification or build repair failed |
| `skipped` | Verification not run |

## Deploy shapes

| Shape | Typical target |
|-------|----------------|
| `static` | S3 |
| `static_build` (no start command) | S3 |
| `static_build` (with start command) | ECS |
| `server` | ECS |
| `multi` | ECS (multiple units) |
| `existing_docker` | ECS via Dockerfile |

## Related

- [Error Catalog](./ERROR_CATALOG.md)
- [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
- [Glossary](./GLOSSARY.md)