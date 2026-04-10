# SmartDeploy

A deployment workspace built with Next.js. Connect a GitHub repo, generate a release blueprint, and ship with live logs and rollout visibility in one place.

---

## Features

- **GitHub sign-in** — OAuth via NextAuth; your token is used to clone private repos.
- **Release blueprinting** — Gemini (or a local LLM) analyses the repo and suggests a Dockerfile, build commands, and stack info.
- **Live deploy visibility** — A WebSocket worker runs the pipeline and streams every step to the browser.
- **AWS EC2 deploys** — Provisions an instance, builds a Docker image (locally or via CodeBuild + ECR), runs the container, and optionally wires up an ALB with HTTPS and custom-domain routing.
- **Google Cloud Run deploys** — Builds via Cloud Build and deploys to Cloud Run, with multi-service support.
- **Deployment management** — Start, stop, and delete deployments from the dashboard.
- **Custom domains** — Visit links use `https://{service}.{your-domain}`; optional Vercel DNS integration creates CNAME records automatically.

---

## Architecture

| Component | Role |
|-----------|------|
| **Next.js app** (port 3000) | Dashboard UI, REST API routes, NextAuth, AI analysis |
| **WebSocket server** (port 4001) | Long-running deploy worker — clones repos, builds Docker images, calls cloud APIs |

Both run together via `npm run start-all` (dev) or `docker compose up` (production).

---

## Tech stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, Zustand
- **Database**: Supabase (PostgreSQL)
- **Auth**: NextAuth.js (GitHub + Google)
- **AI**: Google Gemini, with optional local LLM (Ollama) and AWS Bedrock fallbacks
- **Cloud SDKs**: AWS (EC2, ELB, CodeBuild, ECR, SSM, IAM, STS), GCP (Cloud Run, Cloud Build, Logging)
- **Tests**: Vitest (unit), Playwright (e2e)

---

## Quick start (local development)

### 1. Clone

```bash
git clone https://github.com/anirudh-makuluri/smart-deploy.git
cd smart-deploy
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Create a Supabase project and run the schema migration. See **[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)** for step-by-step instructions.

### 4. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at least the **required** values. The file is heavily commented — see [`.env.example`](.env.example) for details.

**Minimum for local dev:**

| Variable | Where to get it |
|----------|----------------|
| `GITHUB_ID` / `GITHUB_SECRET` | [GitHub OAuth App](https://github.com/settings/developers) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard (Project Settings -> API) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS IAM (see [docs/AWS_IAM_SETUP.md](docs/AWS_IAM_SETUP.md)) |

### 5. Start the app + worker

```bash
npm run start-all
```

This runs `next dev` (port 3000) and the WebSocket server (port 4001) together. Alternatively, run them separately:

```bash
npm run dev    # terminal 1
npm run ws     # terminal 2
```

Open [http://localhost:3000](http://localhost:3000), sign in with GitHub, and deploy a repo.

---

## Production deployment (Docker Compose)

```bash
cp .env.example .env
# fill in all values

docker compose up --build -d
```

The Compose file starts two containers (`app` on port 3000, `websocket` on port 4001). The worker container mounts `docker.sock` to build images on the host.

To deploy SmartDeploy itself on an EC2 instance with Nginx and SSL, see **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

---

## Cloud provider setup

| Provider | Guide |
|----------|-------|
| **AWS** (EC2 deployments) | [docs/AWS_IAM_SETUP.md](docs/AWS_IAM_SETUP.md) |
| **GCP** (Cloud Run deployments) | [docs/GCP_SETUP.md](docs/GCP_SETUP.md) |

You only need to set up the provider(s) you plan to deploy to.

---

## Additional guides

| Topic | Guide |
|-------|-------|
| Database (Supabase) | [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) |
| Custom domains & DNS | [docs/CUSTOM_DOMAINS.md](docs/CUSTOM_DOMAINS.md) |
| Self-hosting on EC2 | [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) |
| SSL certificates | [scripts/README-SSL.md](scripts/README-SSL.md) |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run ws` | WebSocket deploy worker |
| `npm run start-all` | Dev server + worker (concurrently) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright end-to-end tests |

See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) for the shell scripts under `scripts/` (deploy, update, SSL, logs, status).

---

## Environment variables reference

All variables are documented in [`.env.example`](.env.example). Here's a summary grouped by category:

| Category | Variables | Required |
|----------|-----------|----------|
| **Auth** | `GITHUB_ID`, `GITHUB_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | GitHub + NextAuth yes |
| **Database** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes |
| **WebSocket** | `NEXT_PUBLIC_WS_URL`, `WS_PORT` | URL yes |
| **AI** | `GEMINI_API_KEY`, `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, `BEDROCK_MODEL_ID` | At least one |
| **AWS** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EC2_ACM_CERTIFICATE_ARN`, `USE_CODEBUILD`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | If using AWS |
| **AWS Bedrock** | `AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY` | If using Bedrock |
| **GCP** | `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` | If using GCP |
| **Domains** | `NEXT_PUBLIC_DEPLOYMENT_DOMAIN`, `VERCEL_TOKEN`, `VERCEL_DOMAIN` | Domain yes |
| **Misc** | `ENVIRONMENT`, `NODE_MAX_OLD_SPACE_SIZE`, `DEPLOYMENT_SCREENSHOT_BUCKET` | No |

---

## License

MIT
