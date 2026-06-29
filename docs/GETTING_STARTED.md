# Getting Started

This guide walks through your first deployment on Smart Deploy.

## Prerequisites

- A GitHub account linked to Smart Deploy
- Access approved for your email (if your instance uses a waiting list)
- A repository Smart Deploy can scan (Node, Python, Go, Docker, static site, or monorepo)

## 1. Sign in and connect GitHub

Sign in with GitHub so Smart Deploy can list repos, read branches, and clone code for scans and deploys.

If repo actions fail with **GitHub not connected**, link GitHub from your account settings and retry.

## 2. Open a repository

From the dashboard, open `owner/repo`. Smart Deploy loads the repo and any existing deployments.

## 3. Detect services

If no services appear, run **Detect services**. Smart Deploy walks the repo and lists deployable units — root app, monorepo packages, compose directories, or Dockerfile folders.

For monorepos, you may see multiple services. Each gets its own deployment row.

See [Monorepos and Multi-Service](./MONOREPOS_AND_MULTI_SERVICE.md).

## 4. Select a service and run Smart Analysis

Pick the service you want to deploy (for example `web` or `.` for the root app).

Run **Smart Analysis** (scan). Progress moves through:

1. Scanner — resolve commit and scope
2. Clone repo
3. Classifier — deploy shape and units
4. Railpack prepare — build plan
5. Deploy briefing — operator summary
6. Build and repair — verify build (when enabled)
7. Finalize

When the scan completes, review **build status** and the deploy briefing before deploying.

See [Smart Analysis](./SMART_ANALYSIS.md).

## 5. Review the blueprint

Open the **blueprint** to see the full pipeline before anything runs:

- Which branch and commit will deploy
- Build units and artifacts (Railpack plan or Dockerfile)
- AWS region and target (ECS or static S3)
- Env vars and subdomain
- Final public URL

Adjust branch, region, env vars, or hosted subdomain from preview if needed.

See [Blueprint and Preview](./BLUEPRINT_AND_PREVIEW.md).

## 6. Deploy

When the preview looks right, start the deploy. Watch live step logs:

- Auth → Build → Publish → Deploy → Rollout → Verify → Done

On success you get a **Visit** URL like `https://your-service.yourdomain.com`.

See [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md).

## 7. Confirm it is running

- **Overview** — URL, screenshot, runtime health sparkline
- **Logs** — deploy steps or ECS CloudWatch tail for running services
- **History** — all deploy attempts

Ask the **Deployment Agent** (header **Agent** button): *"Is my service healthy right now?"*

## If something fails

1. Open **Deployment History** and find the failed run
2. Read the first error line in the failed step's logs
3. Ask the **Deployment Agent**: *"Why did my last deployment fail?"*
4. Use **Analyze failure** on that history entry for a deeper explanation
5. Follow [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)

## Common first-deploy issues

| Symptom | Where to look |
|---------|---------------|
| Scan fails | [Smart Analysis](./SMART_ANALYSIS.md), [Build Failures](./BUILD_FAILURES.md) |
| Deploy fails at Build | [Build Failures](./BUILD_FAILURES.md), [Railpack](./RAILPACK.md) |
| Deploy succeeds but URL unhealthy | [Health Checks](./HEALTH_CHECKS.md), [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md) |
| Wrong Node/Python version | [Railpack](./RAILPACK.md) — version files and `RAILPACK_PACKAGES` |

## Next steps

- [Environment Variables](./ENVIRONMENT_VARIABLES.md) — configure build and runtime
- [Custom Domains](./CUSTOM_DOMAINS.md) — how URLs are formed
- [FAQ](./FAQ.md)