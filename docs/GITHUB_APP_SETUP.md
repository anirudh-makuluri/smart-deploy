# GitHub App (auto-deploy on push)

Register a **GitHub App** on your GitHub user or organization and wire it to SmartDeploy.

## Testing on `localhost:3000`

Use this when you run Next.js locally (`npm run dev`) and want to exercise install + setup before production.

### What works on localhost

| Flow | URL | Notes |
|------|-----|--------|
| **Setup URL** (browser redirect after install) | `http://localhost:3000/api/github-app/setup` | GitHub opens this in **your browser**, so it can reach your machine. Set this in the GitHub App settings. |
| **Webhook** (`push` events) | Not reachable at `localhost` from GitHub’s servers | GitHub must POST to a **public HTTPS** URL. For local testing use a tunnel (e.g. [ngrok](https://ngrok.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/), [localtunnel](https://localtunnel.github.io/www/)) and set the webhook to `https://<tunnel-host>/api/webhooks/github`. |

### Local env checklist

1. Set **`NEXTAUTH_URL=http://localhost:3000`** in `.env` so redirects after sign-in and the setup callback use the right origin (see `appBaseUrl()` in [`src/app/api/github-app/setup/route.ts`](../src/app/api/github-app/setup/route.ts)).
2. Run the app: `npm run dev` (port 3000).
3. Run the deploy worker: `npm run ws` (default `DEPLOY_WORKER_URL=http://127.0.0.1:4001`).
4. Set **`DEPLOY_WORKER_SECRET`** (any strong random string) in `.env` for both Next.js and the same value the worker reads (worker authorizes `POST /internal/auto-deploy` with `Authorization: Bearer <secret>`).

Without a tunnel, you can still test **Install app → setup route saves `installation_id`**. Auto-deploy on **push** only runs once webhooks hit your Next route and forward to the worker.

---

## Callback / setup URL (what to enter in GitHub)

In the GitHub App settings, use:

- **Local dev:** `http://localhost:3000/api/github-app/setup`  
- **Production:** `https://<your-domain>/api/github-app/setup`

This is the URL GitHub redirects to **after installation** (with `installation_id` and `state` query params). You must be **signed in** to SmartDeploy (NextAuth); if not, you are sent to `/auth` with a `callbackUrl` back to this URL.

There is no separate “OAuth callback URL” required on the GitHub App for this feature: SmartDeploy uses the **GitHub App JWT + installation access token** to clone repos for auto-deploy. Sign-in remains your existing **NextAuth GitHub OAuth** (`GITHUB_ID` / `GITHUB_SECRET`), which is unrelated to the App’s optional user OAuth toggle.

---

## Request user authorization (OAuth) on the GitHub App?

**No — not required** for auto-deploy as implemented.

- **Installation access tokens** (from the App ID + private key) are enough for **`Contents: Read-only`** and `git clone` over HTTPS.
- Enabling **“Request user authorization (OAuth) during installation”** is only needed if you want **user-to-server** tokens from the App (e.g. acting as the installing user for extra API scopes). This codebase does not use that for deploy.

You can leave **Request user authorization** **off** unless you add features that need it.

---

## Enable device flow?

**No.**

Device flow is for **CLI or devices without a browser** to complete OAuth. SmartDeploy’s flow is: browser → GitHub → redirect to `/api/github-app/setup`. Leave device flow **disabled**.

---

## App settings (summary)

| Setting | Local example | Production example |
|--------|----------------|-------------------|
| **Webhook** | `https://<tunnel>/api/webhooks/github` | `https://<your-domain>/api/webhooks/github` |
| **Webhook secret** | Random string → `GITHUB_APP_WEBHOOK_SECRET` | Same |
| **Repository permissions** | **Contents**: Read-only | Same |
| **Subscribe to events** | **Push** (optional **Ping** for checks) | Same |
| **Setup URL** (after install) | `http://localhost:3000/api/github-app/setup` | `https://<your-domain>/api/github-app/setup` |

After creation, note the **App ID** and generate a **private key** (PEM).

---

## Environment variables

Add to `.env` (server-only; never expose the private key or webhook secret to the client):

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_URL` | Local: `http://localhost:3000` |
| `GITHUB_APP_ID` | Numeric App ID |
| `GITHUB_APP_PRIVATE_KEY` | PEM contents; newlines can be `\n` in a single line |
| `GITHUB_APP_WEBHOOK_SECRET` | Same secret as configured on the app webhook |
| `GITHUB_APP_CLIENT_ID` | Optional for this flow; not required for installation token + JWT |
| `GITHUB_APP_CLIENT_SECRET` | Optional; same |
| `NEXT_PUBLIC_GITHUB_APP_SLUG` | App slug from `github.com/apps/<slug>` — used for the “Install app” link |
| `DEPLOY_WORKER_URL` | Default `http://127.0.0.1:4001` |
| `DEPLOY_WORKER_SECRET` | Shared secret for `POST /internal/auto-deploy` |

The Next.js app verifies webhooks and forwards jobs to the worker so long-running deploys are not bound by short serverless timeouts. Run the worker with `npm run ws` (same machine as local testing).

---

## Database

Fresh install: columns are in [`supabase/schema.sql`](../supabase/schema.sql).  
Existing DB: apply [`supabase/migrations/20250320120000_auto_deploy.sql`](../supabase/migrations/20250320120000_auto_deploy.sql).
