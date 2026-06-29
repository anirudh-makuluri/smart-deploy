# Blueprint and Preview

The blueprint answers one question before deploy:

**What exactly is going to happen to this app?**

It is the center of the product — a visual pipeline you can read and edit without losing context.

## Five preview steps

| Step | What you see |
|------|--------------|
| **Auth and resolve ref** | Repo, branch, commit SHA |
| **Build** | Deploy units, Railpack plans or Dockerfile, CodeBuild output (ECR or S3) |
| **Setup** | AWS region, Fargate networking or static bucket |
| **Deploy** | Runtime env vars (Secrets Manager on ECS), ALB host rules |
| **Done** | Hosted subdomain and public Visit URL |

Each step surfaces artifacts: Railpack plan JSON, Docker build units, ECS prerequisites, and domain routing.

## What you can edit in preview

| Field | Effect |
|-------|--------|
| **Branch** | Which ref CodeBuild checks out |
| **Region** | Where AWS resources are created |
| **Env vars** | Build-time vars to CodeBuild; runtime vars to ECS Secrets Manager |
| **Hosted subdomain** | Hostname on the platform domain (`myapp.example.com`) |

Edits stay in the same preview surface — you do not lose the pipeline context.

## Reading Railpack artifacts

When the scan used Railpack, the blueprint shows:

- **Deploy units** — name, root path, framework, port, provider
- **Railpack plan** — install/build steps and `deploy.startCommand`
- **Build status** — passed, failed, or skipped from verification

A missing Railpack plan on a non-Docker unit is a blocker — re-run Smart Analysis or use Improve scan.

See [Railpack](./RAILPACK.md) and [Smart Analysis](./SMART_ANALYSIS.md).

## Deploy shape indicators

| Shape | Blueprint hint |
|-------|----------------|
| `server` | Container on ECS via Railpack |
| `static` / `static_build` (no start command) | Static S3 path |
| `static_build` (with start command) | Container serving built assets |
| `existing_docker` | Dockerfile via CodeBuild → ECS |
| `multi` | Multiple deploy units; compose-style builds |

## Validation before deploy

The preview model warns when:

- Build status is not passed (when verification ran)
- Railpack plan is missing for a unit
- Required scan data is incomplete

Review warnings in the blueprint before pressing deploy.

## After preview

When the plan looks right:

1. Deploy from the workspace
2. Watch the same stages execute with live logs
3. Compare blueprint expectations to actual step output if something fails

## Related

- [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md)
- [Getting Started](./GETTING_STARTED.md)
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)