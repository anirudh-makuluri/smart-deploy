# What is Smart Deploy?

Smart Deploy is a **preview-driven deployment platform** for solo developers. You scan a GitHub repo, review a live blueprint of what will run, adjust configuration in context, and deploy only when the plan makes sense.

**Preview the deploy. Then ship it.**

## The problem

Most deployment tools ask you to commit before you can see the plan.

- A PaaS moves fast, but the real deploy path stays hidden until something breaks.
- Raw cloud tooling gives control, but dumps the full surface area on you at once.
- Solo developers need a middle path: ship quickly without flying blind.

Smart Deploy is built around **preview**. You should know what will run, how traffic will flow, and which cloud resources are involved before you press deploy.

## What you get

| Capability | Why it matters |
|------------|----------------|
| **Repo scan** | Detects services, frameworks, and deploy shape automatically |
| **Blueprint preview** | Shows build units, routing, and cloud targets before anything runs |
| **Editable config** | Branch, region, env vars, and subdomain from the same preview surface |
| **Real cloud deploys** | ECS Fargate for containers, S3 (+ optional CloudFront) for static sites |
| **Queued execution** | Each deploy runs as an isolated ECS task, ordered per service via SQS |
| **Live feedback** | Stream deploy logs, track history, and watch health update in place |
| **Deployment Agent** | Ask questions about your deployments, history, and runtime health |

## Who it is for

Smart Deploy targets developers who:

- Want PaaS-like speed without a black-box deploy path
- Ship from GitHub and need multi-service or monorepo support
- Prefer inspecting infrastructure before committing cloud resources
- Need structured debugging when production deploys fail

## What Smart Deploy is not

- **Not a generic CI runner** — deploys are opinionated paths to AWS (ECS or static S3).
- **Not a local dev environment** — it builds and runs your app in cloud primitives.
- **Not fully multi-cloud today** — production deploy code targets AWS; GCP paths are not active in the current deploy handler.

## Next steps

- [Getting Started](./GETTING_STARTED.md) — first deployment walkthrough
- [How It Works](./HOW_IT_WORKS.md) — architecture and data flow
- [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md) — what happens when you deploy