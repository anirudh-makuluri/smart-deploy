# FAQ

## Getting started

### What is Smart Deploy?

A preview-driven deployment platform. Scan a repo, review a blueprint, edit config, then deploy to AWS (ECS or static S3).

See [What is Smart Deploy](./WHAT_IS_SMART_DEPLOY.md).

### How do I deploy my first app?

Connect GitHub → open repo → detect services → Smart Analysis → review blueprint → deploy.

See [Getting Started](./GETTING_STARTED.md).

### Why am I sent to `/waiting-list` after sign-in?

Your email is not on the approved users list for this Smart Deploy instance. Contact the platform operator for access.

## GitHub and repos

### Can I deploy without GitHub?

GitHub is required for repo scanning, cloning, and deploys from Git repositories.

### "GitHub not connected" — what does that mean?

Your session has no linked GitHub OAuth token. Sign in with GitHub or link GitHub in account settings.

### Does Smart Deploy support monorepos?

Yes. It detects workspace packages, compose dirs, and multiple services. Each service can have its own deployment.

See [Monorepos and Multi-Service](./MONOREPOS_AND_MULTI_SERVICE.md).

## Scan and Railpack

### What is Smart Analysis?

The repo scan that detects deploy shape, generates Railpack plans, and optionally verifies builds.

See [Smart Analysis](./SMART_ANALYSIS.md).

### What is Railpack?

The default build system that produces container images from your repo without a Dockerfile. It uses Mise for runtimes.

See [Railpack](./RAILPACK.md).

### Why did build verification fail?

Dependency errors, wrong runtime version, or monorepo path issues. Review scan logs and `repair_history`, then try Improve scan.

See [Build Failures](./BUILD_FAILURES.md).

## Deploy and runtime

### ECS vs static S3 — how is it chosen?

Server apps and containers go to ECS. Plain static files and build-only SPAs (no Railpack start command) go to S3.

See [How It Works](./HOW_IT_WORKS.md).

### My app works locally but deploy fails — why?

Common causes: missing env vars at build/runtime, wrong port binding, lockfile not committed, or Node/Python version mismatch.

See [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md).

### Deploy succeeded but URL returns 502/503

Usually runtime startup failure — port, missing `DATABASE_URL`, or crash on boot. Check CloudWatch logs and health probes.

See [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md).

### Which port should my app listen on?

Use `PORT` from the environment. Bind `0.0.0.0`, not `127.0.0.1`. Default depends on framework (often 3000 for Node).

### How do env vars work?

Build-time vars go to CodeBuild; runtime vars on ECS go to Secrets Manager. Redeploy after runtime changes.

See [Environment Variables](./ENVIRONMENT_VARIABLES.md).

## URLs and domains

### How is my deployment URL generated?

`https://{hosted-subdomain}.{deployment-domain}` — you pick the subdomain in config.

See [Custom Domains](./CUSTOM_DOMAINS.md).

### Domain not loading after deploy?

Wait for DNS propagation, confirm subdomain spelling, redeploy after DNS-related config changes.

See [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md).

## Debugging and AI

### What does the Agent button do?

Opens the **Deployment Agent** — read-only AI that inspects your deployments, history, and health.

See [Deployment Agent](./DEPLOYMENT_AGENT.md).

### Why is the Deployment Agent offline?

The WebSocket worker is disconnected. Refresh the page; check system health indicator in the header.

### Agent says it hit the tool-call limit

Ask a narrower question or open Deployment History for full logs. Use Analyze failure for one failed run.

See [AI Assistance](./AI_ASSISTANCE.md).

### How do I roll back?

Pick a successful entry in Deployment History and confirm rollback. Redeploys that commit; keeps current env vars.

See [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md).

## Where to start when stuck

1. [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md)
2. [Error Catalog](./ERROR_CATALOG.md)
3. Deployment Agent in the header