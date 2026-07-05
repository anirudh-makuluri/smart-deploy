# Smart Deploy Documentation

User-facing guides for deploying and debugging apps on Smart Deploy. These docs focus on **your deployments**, not platform self-hosting.

## Learn

| Guide | Summary |
|-------|---------|
| [What is Smart Deploy](./WHAT_IS_SMART_DEPLOY.md) | Why the platform exists and who it is for |
| [How It Works](./HOW_IT_WORKS.md) | Scan → blueprint → deploy → monitor at a high level |
| [Getting Started](./GETTING_STARTED.md) | Connect a repo and ship your first deployment |
| [Glossary](./GLOSSARY.md) | Key terms used across the product |

## Deploy

| Guide | Summary |
|-------|---------|
| [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md) | Queue, executor, and stages from clone to live URL (ECS and static S3) |
| [Blueprint and Preview](./BLUEPRINT_AND_PREVIEW.md) | Read and edit the deploy plan before you ship |
| [Smart Analysis](./SMART_ANALYSIS.md) | Repo scan, deploy shapes, and build verification |
| [Railpack](./RAILPACK.md) | How apps are built, including Mise runtimes |
| [Monorepos and Multi-Service](./MONOREPOS_AND_MULTI_SERVICE.md) | Multiple services per repo and package paths |
| [Environment Variables](./ENVIRONMENT_VARIABLES.md) | Build-time vs runtime configuration |
| [Custom Domains](./CUSTOM_DOMAINS.md) | Deployment URLs, subdomains, DNS, and HTTPS |

## Debug

| Guide | Summary |
|-------|---------|
| [Debugging Deployments](./DEBUGGING_DEPLOYMENTS.md) | Step-by-step runbook for failed or unhealthy deploys |
| [Deployment Agent](./DEPLOYMENT_AGENT.md) | AI inspector for status, history, and health |
| [AI Assistance](./AI_ASSISTANCE.md) | When to use the agent, Analyze failure, and Improve scan |
| [Deployment Logs](./DEPLOYMENT_LOGS.md) | Live logs, history, and ECS CloudWatch |
| [Health Checks](./HEALTH_CHECKS.md) | Post-deploy verification and app health endpoints |
| [Runtime Health](./RUNTIME_HEALTH.md) | Ongoing health signals and status meanings |
| [Deployment History and Rollback](./DEPLOYMENT_HISTORY_AND_ROLLBACK.md) | Past attempts and manual rollback |
| [Build Failures](./BUILD_FAILURES.md) | CodeBuild, Railpack, and Docker build errors |
| [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md) | Crashes, ports, and 502/503 after deploy |
| [Domain and TLS Issues](./DOMAIN_AND_TLS_ISSUES.md) | DNS propagation and certificate problems |

## Reference

| Guide | Summary |
|-------|---------|
| [FAQ](./FAQ.md) | Common questions |
| [Error Catalog](./ERROR_CATALOG.md) | Symptom-first errors with checks and fixes |
| [Deployment Status Reference](./DEPLOYMENT_STATUS_REFERENCE.md) | Status vocabulary, stages, and failure codes |

## AI agents

- Index: [/llms.txt](/llms.txt)
- Full snapshot: [/llms-full.txt](/llms-full.txt)