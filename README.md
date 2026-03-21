# SmartDeploy

**SmartDeploy** is a DevOps-style dashboard built with Next.js. Connect a GitHub account, scan a repository, tune build/run settings and environment variables, and deploy to **AWS (Docker on EC2)** or **Google Cloud Run**. A small **WebSocket worker** runs the long-lived deploy pipeline (clone, Docker, cloud APIs) so the UI can stream logs in real time.

---

## Features

- **GitHub sign-in** — NextAuth with GitHub and Google OAuth; OAuth token used to clone private repos you can access.
- **Repo scan & config** — AI-assisted analysis (`/api/llm`) suggests stack, commands, and Dockerfile content; optional **SSE streaming** scan proxies to a separate analyzer on `localhost:8080` (see below).
- **Two cloud paths** — **AWS**: EC2-based Docker deploy (VPC, optional ALB/custom domain hooks). **GCP**: Cloud Run via `gcloud` (Cloud Build, `us-central1` for the CLI deploy path in code).
- **Multi-service on GCP** — Multiple services from scan results / compose-style detection can deploy to Cloud Run; **Cloud SQL** can be provisioned when `detectDatabase` finds a supported DB configuration in that flow.
- **Live deploy logs** — WebSocket worker (`npm run ws`, default port `4001`) streams steps and logs to the UI.
- **Deployment control** — Start/stop (pause/resume) **AWS EC2** instances for saved deployments via the deployment control API.
- **Custom hostnames** — Visit links use `https://{service-name}.{NEXT_PUBLIC_DEPLOYMENT_DOMAIN}`; optional **Vercel DNS** API integration to create CNAMEs automatically.
- **Self-hosted** — Docker Compose (`app` + `websocket`) and EC2 scripts under `scripts/` (including swap for small instances).

---

## Architecture

| Piece | Role |
|--------|------|
| **Next.js app** | UI, REST routes, NextAuth, calls to Gemini/local LLM, proxies streaming scan to `:8080` when used. |
| **WebSocket server** | `src/websocket-server.ts` — runs deploy jobs, talks to Docker and cloud CLIs/SDKs. Start with `npm run ws` (or the `websocket` service in `docker-compose.yml`). |
| **Optional analyzer** | `src/app/api/scan/stream/route.ts` forwards to `http://localhost:8080/analyze/stream`. That service is **not** in this repo’s `docker-compose.yml`; without it, use the non-streaming LLM flow for analysis. |

---

## Tech stack

- **App**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Radix/shadcn-style UI, TanStack Query, Zustand.
- **Data**: Supabase (PostgreSQL) for users, deployments, history, cached repo metadata — run `supabase/schema.sql` in the Supabase SQL editor.
- **Auth**: NextAuth.js — GitHub + Google providers.
- **AI**: Google **Gemini** (`gemini-2.5-flash`) when `GEMINI_API_KEY` is set; optional **local LLM** via `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` (Ollama-compatible JSON API). *(AWS Bedrock helpers exist in code but are not wired into the live LLM route.)*
- **Cloud**: AWS SDK (EC2, RDS, ELB, SSM, S3, IAM, STS), Google Cloud Run / Cloud Build / logging (via `gcloud` and libraries where used).
- **Tests**: Vitest (`npm test`), Playwright e2e (`npm run test:e2e`).

---

## Prerequisites

- **Node.js 20+** (matches `Dockerfile` base image).
- **Docker** — required on the machine that runs the WebSocket worker for builds and deploys.
- **GCP path**: `gcloud` CLI installed and usable by the worker, plus `GCP_PROJECT_ID` and `GCP_SERVICE_ACCOUNT_KEY` in `.env`.
- **AWS path**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and region — see [docs/AWS_IAM_SETUP.md](docs/AWS_IAM_SETUP.md) for permission shape (note: the doc mentions some services broadly; the app’s AWS **deploy** path is **EC2-centric**).

---

## Running locally

### 1. Clone

```bash
git clone https://github.com/anirudh-makuluri/smart-deploy.git
cd smart-deploy
```

### 2. Install

```bash
npm install
```

### 3. Environment

Copy **`.env.example`** to **`.env`** and fill in at least:

- **NextAuth**: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, GitHub and/or Google OAuth IDs/secrets.
- **Supabase**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (after applying `supabase/schema.sql`).
- **WebSocket**: `NEXT_PUBLIC_WS_URL` (e.g. `ws://localhost:4001` for local dev).
- **AI (optional but recommended)**: `GEMINI_API_KEY` and/or `LOCAL_LLM_BASE_URL` (+ `LOCAL_LLM_MODEL` if needed).
- **Cloud**: AWS and/or GCP variables depending on which provider you use.

For **auto-deploy on push** (GitHub App → worker), see [docs/GITHUB_APP_SETUP.md](docs/GITHUB_APP_SETUP.md) (`GITHUB_APP_*`, `DEPLOY_WORKER_URL`, `DEPLOY_WORKER_SECRET`).

### 4. Start app + worker

```bash
npm run start-all
```

This runs `next dev` and the WebSocket server together (`concurrently`). Alternatively run `npm run dev` and `npm run ws` in two terminals.

### 5. Production-like stack (Docker)

```bash
docker compose up --build
```

Ensure `.env` is complete; the worker container expects access to **Docker** (see `docker-compose.yml` — `websocket` mounts `docker.sock`).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run ws` | WebSocket deploy worker |
| `npm run start-all` | Dev + worker |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright (starts dev server via config) |

---

## Managed databases

- **GCP (multi-service Cloud Run path)**: If the multi-service deploy detects a database via `detectDatabase`, the worker can create **Cloud SQL** and wire connection strings into deploy steps.
- **AWS**: The deploy pipeline includes an **RDS** step when a DB config is present; in the current **single-service EC2** entry in `handleDeploy`, DB config is not populated, so automatic RDS from that path is **not** active until wired — the **RDS helpers** remain in the codebase for future or custom integration.

For connection-string formats and behavior, prefer reading `src/lib/handleDatabaseDeploy.ts`, `src/lib/aws/handleRDS.ts`, and `src/lib/databaseDetector.ts`.

---

## AI & scan UX

- **One-shot analysis**: `POST /api/llm` returns JSON-oriented deployment hints using Gemini (then optional local LLM fallback).
- **Failure hints**: `POST /api/llm/analyze-failure` summarizes failed deploy logs.
- **Streaming scan UI**: Calls `/api/scan/stream`, which expects an analyzer at **`http://localhost:8080`**. Run that service separately or rely on the LLM route for analysis.
- Scan result types can include **Hadolint-style Dockerfile feedback** in the UI when the scan payload includes `hadolint_results` (typically from the external analyzer).

---

## Custom domains & Vercel DNS

“Visit” URLs use `NEXT_PUBLIC_DEPLOYMENT_DOMAIN`. If `VERCEL_TOKEN` (and domain settings) are set, the app can create/update **CNAME** records via Vercel’s API. Otherwise add DNS manually at your provider. Targets are the actual deploy endpoints (e.g. Cloud Run URLs, EC2/ALB hostnames), not legacy Amplify-specific flows.

---

## Self-hosting on small EC2 (e.g. t3.micro)

Low-RAM instances need **swap** for `next build`. See **[docs/T3_MICRO.md](docs/T3_MICRO.md)** (`scripts/setup-swap.sh`, `scripts/deploy.sh`, `scripts/update.sh`).

---

## Documentation

| Doc | Topic |
|-----|--------|
| [docs/GITHUB_APP_SETUP.md](docs/GITHUB_APP_SETUP.md) | GitHub App, webhooks, auto-deploy, worker secret |
| [docs/AWS_IAM_SETUP.md](docs/AWS_IAM_SETUP.md) | AWS IAM permissions for deploy |
| [docs/T3_MICRO.md](docs/T3_MICRO.md) | Swap and EC2 sizing for builds |
| [scripts/README-SSL.md](scripts/README-SSL.md) | SSL-related scripts (if used in your setup) |
