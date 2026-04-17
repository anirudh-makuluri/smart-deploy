# Smart Deploy

<p align="center">
   <img src="public/icons/icon.svg" alt="Smart Deploy logo" width="96" height="96" />
</p>

<p align="center">
   <strong>Smart Deploy</strong> is a transparent deployment platform for solo developers.
</p>

<p align="center">
   <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT license" /></a>
   <a href="https://github.com/anirudh-makuluri/smart-deploy/actions/workflows/ci.yml"><img src="https://github.com/anirudh-makuluri/smart-deploy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
   <a href="https://github.com/anirudh-makuluri/smart-deploy/issues"><img src="https://img.shields.io/github/issues/anirudh-makuluri/smart-deploy" alt="Open issues" /></a>
   <a href="https://github.com/anirudh-makuluri/smart-deploy/pulls"><img src="https://img.shields.io/github/issues-pr/anirudh-makuluri/smart-deploy" alt="Open pull requests" /></a>
   <a href="https://github.com/anirudh-makuluri/smart-deploy/commits/main"><img src="https://img.shields.io/github/last-commit/anirudh-makuluri/smart-deploy/main" alt="Last commit" /></a>
</p>

<p align="center">
   It sits between a PaaS and raw cloud infrastructure. You can write your own deploy files or generate them, inspect the deployment in a blueprint view, review how Docker, `docker-compose.yml`, and Nginx will be used, and then deploy with confidence.
</p>

<p align="center"><em>Deploy like a PaaS. Understand it like the cloud.</em></p>

## Highlights

| What you get | Why it matters |
|--------------|----------------|
| Blueprint-first deploy flow | Inspect the deployment path before anything runs |
| Bring-your-own infra files | Use a Dockerfile, `docker-compose.yml`, and Nginx config you already trust |
| AWS and GCP support | Keep the workflow grounded in real cloud primitives |

## Table of Contents

- [Highlights](#highlights)
- [The problem](#the-problem)
- [What Smart Deploy does](#what-smart-deploy-does)
- [Workflow](#workflow)
- [Core experience](#core-experience)
- [Architecture overview](#architecture-overview)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Production notes](#production-notes)
- [Access control](#access-control)
- [Environment variables reference](#environment-variables-reference)
- [Repo guides](#repo-guides)
- [Scripts](#scripts)
- [License](#license)

## The problem

Most deployment tools force an uncomfortable tradeoff:

- A PaaS is easy to use, but it hides too much of the real deploy.
- Raw cloud infrastructure gives full control, but it exposes too much surface area at once.
- Solo developers and small teams often need something in the middle.

Smart Deploy is built for that middle ground. The goal is not to hide infrastructure. The goal is to make it understandable enough that you can ship and learn at the same time.

## What Smart Deploy does

- Lets you bring your own Dockerfile, `docker-compose.yml`, and Nginx config, or generate a starting point from the repo
- Shows a blueprint view before deploy so you can inspect the deployment path
- Explains how each generated or existing infrastructure file is used in the deploy
- Keeps logs, health, status, and preview output connected to the same deployment workflow
- Supports AWS and GCP deployment paths while keeping the deploy surface grounded in real infrastructure concepts

## Workflow

Smart Deploy is organized around three steps:

1. Define it
   Write or generate the infrastructure files for your app.
2. Preview it
   Inspect the blueprint view and review the deployment path before anything runs.
3. Deploy it
   Start the deploy once the plan makes sense, then follow logs, health, and preview output.

## Core experience

### Where it fits

Smart Deploy targets the gap between convenience and control:

- A PaaS is easy to use, but it hides too much of the real deploy.
- Raw cloud infrastructure gives full control, but it exposes too much surface at once.
- Smart Deploy sits in the middle: ship from a guided workflow without losing sight of containers, compose, and routing.

### Blueprint view

The blueprint view is the center of the product. It exists to answer one question before deploy:

What exactly is going to happen to this app?

It shows:

- which services will run
- how containers are built and started
- how services connect
- how traffic is routed
- which generated artifacts are part of the deploy

### Generated infrastructure review

Smart Deploy treats infrastructure files as first-class product output, not hidden implementation details.

- `Dockerfile` shows how images are built
- `docker-compose.yml` shows how services run together
- `nginx.conf` shows how requests are routed

The product makes these files visible so the deployment stays inspectable.

## Architecture overview

| Component | Role |
|-----------|------|
| Next.js app | Auth, dashboard UI, API routes, and deploy orchestration |
| WebSocket worker | Long-running deploy jobs, log streaming, and worker health endpoints |
| Supabase | User access control, repo metadata, and deployment records |
| SD Artifacts backend | Scan, feedback, artifact, and cache flows used by the app |

The Next.js app hosts sign-in, the repository and dashboard UI, API routes, and the orchestration that drives deploys end to end.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui
- Supabase
- Better Auth
- GraphQL + REST API routes
- WebSocket worker for long-running deploy operations
- AWS SDK and GCP integrations
- Vitest and Playwright

## Quick start

### 1. Clone the repo

```bash
git clone https://github.com/anirudh-makuluri/smart-deploy.git
cd smart-deploy
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql).

Detailed guide:

- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)

### 4. Configure environment variables

```bash
cp .env.example .env
```

Minimum variables for local access:

| Variable | Notes |
|----------|-------|
| `GITHUB_ID`, `GITHUB_SECRET` | GitHub OAuth app credentials |
| `BETTER_AUTH_SECRET` | Shared by the app and WebSocket worker |
| `BETTER_AUTH_URL` | Usually `http://localhost:3000` locally |
| `DATABASE_URL` | Supabase Postgres connection string (server-only) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase credentials |
| `NEXT_PUBLIC_WS_URL` | Usually `ws://localhost:4001` locally |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional. Defaults to the same-origin `/ph` proxy route to reduce adblock noise |

Variables needed for scan and artifact flows:

| Variable | Notes |
|----------|-------|
| `SD_API_BASE_URL` | Base URL for the SD Artifacts backend |
| `SD_API_BEARER_TOKEN` | Bearer token for that backend |
| `GEMINI_API_KEY` | Needed if you use the current Gemini-backed generation flow |

Variables needed for AWS deploys:

| Variable | Notes |
|----------|-------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM credentials |
| `AWS_REGION` | AWS region for deploy operations |

### 5. Approve a user

Sign-in is allowlist-based. Add your email to `approved_users` before signing in.

```sql
insert into public.approved_users (email, name)
values ('you@example.com', 'Your Name')
on conflict (email)
do update set name = excluded.name;
```

Unapproved sign-in attempts are stored in `waiting_list`.

### 6. Start the app and worker

```bash
npm run start-all
```

Or run them separately:

```bash
npm run dev
npm run ws
```

Then open `http://localhost:3000`.

## Production notes

### Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
```

The default Compose setup starts:

- `app` on port `3000`
- `websocket` on port `4001`

### Split deployment

One supported setup is:

- deploy the Next.js app to Vercel
- deploy the WebSocket worker to Render with `Dockerfile.websocket`
- set `NEXT_PUBLIC_WS_URL` to the worker URL
- set `WS_ALLOWED_ORIGINS` on the worker
- keep `BETTER_AUTH_SECRET` identical in both services
- PostHog browser traffic goes through `/ph` by default; only override `NEXT_PUBLIC_POSTHOG_HOST` if you need a different proxy target

The browser no longer falls back to the app host in production, so `NEXT_PUBLIC_WS_URL` must be set to the actual worker endpoint.

Health endpoints:

- `/health` for infrastructure liveness
- `/healthz` for authenticated app-aware checks

## Access control

- Allowed users are stored in `approved_users`
- Rejected sign-in attempts are stored in `waiting_list`
- Browser access to the worker uses short-lived signed WebSocket tokens
- `WS_ALLOWED_ORIGINS` can further restrict which frontends can connect to the worker

## Environment variables reference

| Category | Variables |
|----------|-----------|
| Auth | `GITHUB_ID`, `GITHUB_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` |
| Internal APIs | `SD_API_BASE_URL`, `SD_API_BEARER_TOKEN` |
| WebSocket | `NEXT_PUBLIC_WS_URL`, `WS_ALLOWED_ORIGINS`, `WS_PORT` |
| Generation | `GEMINI_API_KEY`, `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, `BEDROCK_MODEL_ID` |
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EC2_ACM_CERTIFICATE_ARN`, `USE_CODEBUILD`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` |
| AWS Bedrock | `AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY` |
| GCP | `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` |
| Domains | `NEXT_PUBLIC_DEPLOYMENT_DOMAIN`, `VERCEL_TOKEN`, `VERCEL_DOMAIN`, `VERCEL_TEAM_ID` |
| Misc | `ENVIRONMENT`, `NODE_MAX_OLD_SPACE_SIZE`, `DEPLOYMENT_SCREENSHOT_BUCKET` |

See [`.env.example`](.env.example) for the full template.

## Repo guides

- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)
- [docs/AWS_SETUP.md](docs/AWS_SETUP.md)
- [docs/GCP_SETUP.md](docs/GCP_SETUP.md)
- [docs/CUSTOM_DOMAINS.md](docs/CUSTOM_DOMAINS.md)
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)
- [docs/MULTI_SERVICE_DETECTION.md](docs/MULTI_SERVICE_DETECTION.md)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Build the app |
| `npm start` | Start the built app |
| `npm run ws` | Start the WebSocket worker in development |
| `npm run ws:build` | Build the worker into `dist/` |
| `npm run ws:start` | Start the compiled worker |
| `npm run start-all` | Run app and worker together |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run Playwright tests |

## License

MIT
