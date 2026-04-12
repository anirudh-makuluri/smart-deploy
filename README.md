# SmartDeploy

SmartDeploy is a deployment workspace built with Next.js. Connect a GitHub repo, generate deployment artifacts, and ship with live logs and rollout visibility in one place.

---

## Features

- **Approved-user sign-in** - GitHub or Google OAuth via NextAuth, gated by an `approved_users` allowlist in Supabase.
- **Release blueprinting** - Gemini or a compatible backend analyzes a repo and suggests Dockerfiles, compose config, and deployment guidance.
- **Live deploy visibility** - A dedicated WebSocket worker runs long-lived deployment jobs and streams logs to the browser.
- **Service health visibility** - The header shows authenticated health for the WebSocket worker and the SD Artifacts backend.
- **AWS EC2 deploys** - Provision, build, deploy, and manage services on EC2, with optional ALB, HTTPS, and custom-domain support.
- **Google Cloud Run deploys** - Build and deploy supported services to Cloud Run.
- **Deployment management** - Start, stop, pause, resume, and delete deployments from the dashboard.
- **Custom domains** - Visit links can use `https://{service}.{your-domain}` with optional Vercel DNS integration.

---

## Architecture

| Component | Role |
|-----------|------|
| **Next.js app** (port 3000) | Dashboard UI, API routes, NextAuth, GraphQL, and orchestration |
| **WebSocket server** (port 4001) | Long-running deploy worker and authenticated worker health endpoint |
| **SD Artifacts server** | External backend for analyze, feedback, and cache flows |

The app and worker run together in local development via `npm run start-all` or in production via Docker Compose.

---

## Tech stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **State and data**: TanStack Query, Zustand, GraphQL
- **Database**: Supabase PostgreSQL
- **Auth**: NextAuth.js with GitHub and Google providers
- **AI**: Google Gemini, optional local LLM, optional AWS Bedrock
- **Cloud SDKs**: AWS EC2/ELB/CodeBuild/ECR/SSM/IAM/STS, GCP Cloud Run/Cloud Build/Logging
- **Tests**: Vitest and Playwright

---

## Quick start

### 1. Clone

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

See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) for the full setup guide.

### 4. Configure environment variables

```bash
cp .env.example .env
```

At minimum for local app access, fill in:

| Variable | Notes |
|----------|-------|
| `GITHUB_ID`, `GITHUB_SECRET` | GitHub OAuth app credentials |
| `NEXTAUTH_SECRET` | Shared by the main app and WebSocket worker |
| `NEXTAUTH_URL` | Usually `http://localhost:3000` locally |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project credentials |
| `NEXT_PUBLIC_WS_URL` | Usually `ws://localhost:4001` locally |

For analysis and artifact flows, also set:

| Variable | Notes |
|----------|-------|
| `SD_API_BASE_URL` | Base URL for the SD Artifacts backend |
| `SD_API_BEARER_TOKEN` | Bearer token expected by that backend |
| `GEMINI_API_KEY` | Needed if you want Gemini-backed analysis |

For AWS deploys, also set:

| Variable | Notes |
|----------|-------|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM credentials with the required policies |
| `AWS_REGION` | Region for AWS deploy operations |

### 5. Approve a user

Sign-in is allowlist-based. Add your email to `approved_users` in Supabase before signing in. Users who try to sign in before approval are written to `waiting_list`.

Example:

```sql
insert into public.approved_users (email, name)
values ('you@example.com', 'Your Name')
on conflict (email)
do update set name = excluded.name;
```

### 6. Start the app and worker

```bash
npm run start-all
```

Or run them separately:

```bash
npm run dev
npm run ws
```

Open `http://localhost:3000`, sign in, and start deploying.

---

## Production deployment

### Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
```

The Compose setup starts:

- `app` on port `3000`
- `websocket` on port `4001`

### Vercel + Render split

This is a supported production split:

- Deploy the main app to Vercel
- Deploy the WebSocket worker to Render using `Dockerfile.websocket`
- Set `NEXT_PUBLIC_WS_URL` in the main app to your worker URL, for example `wss://smart-deploy.onrender.com`
- Set `WS_ALLOWED_ORIGINS` on the worker to your frontend origins
- Keep `NEXTAUTH_SECRET` identical in the main app and the worker

Health checks:

- Use `/health` for infrastructure liveness checks
- Use `/healthz` for authenticated app-level health checks

---

## Authentication and access control

Sign-in is not open to everyone by default.

- Allowed users are stored in `approved_users`
- Rejected sign-in attempts are stored in `waiting_list`
- The WebSocket server requires a short-lived signed auth token minted by the app
- Worker browser access can be restricted further with `WS_ALLOWED_ORIGINS`

---

## Environment variables reference

| Category | Variables | Notes |
|----------|-----------|-------|
| **Auth** | `GITHUB_ID`, `GITHUB_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Core app auth |
| **Database** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Required |
| **Internal APIs** | `SD_API_BASE_URL`, `SD_API_BEARER_TOKEN` | Required for scan, feedback, and artifact flows |
| **WebSocket** | `NEXT_PUBLIC_WS_URL`, `WS_ALLOWED_ORIGINS`, `WS_PORT` | Worker URL and origin control |
| **AI** | `GEMINI_API_KEY`, `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`, `BEDROCK_MODEL_ID` | Analysis backends |
| **AWS** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EC2_ACM_CERTIFICATE_ARN`, `USE_CODEBUILD`, `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` | Needed for AWS deploys |
| **AWS Bedrock** | `AWS_BEDROCK_ACCESS_KEY_ID`, `AWS_BEDROCK_SECRET_ACCESS_KEY` | Needed only for Bedrock |
| **GCP** | `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_KEY` | Needed for GCP deploys |
| **Domains** | `NEXT_PUBLIC_DEPLOYMENT_DOMAIN`, `VERCEL_TOKEN`, `VERCEL_DOMAIN`, `VERCEL_TEAM_ID` | Needed for DNS and custom domains |
| **Misc** | `ENVIRONMENT`, `NODE_MAX_OLD_SPACE_SIZE`, `DEPLOYMENT_SCREENSHOT_BUCKET` | Optional |

See [.env.example](.env.example) for the commented template.

---

## Additional guides

| Topic | Guide |
|-------|-------|
| Supabase setup | [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) |
| AWS IAM setup | [docs/AWS_IAM_SETUP.md](docs/AWS_IAM_SETUP.md) |
| GCP setup | [docs/GCP_SETUP.md](docs/GCP_SETUP.md) |
| Custom domains | [docs/CUSTOM_DOMAINS.md](docs/CUSTOM_DOMAINS.md) |
| Self-hosting on EC2 | [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Start the built app |
| `npm run ws` | WebSocket worker in development |
| `npm run ws:build` | Build the worker to `dist/` |
| `npm run ws:start` | Start the compiled worker |
| `npm run start-all` | Run app and worker together |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run Playwright tests |

---

## License

MIT
