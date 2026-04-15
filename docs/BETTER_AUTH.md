# Better Auth in SmartDeploy

This repo uses the [`better-auth`](https://www.better-auth.com/) npm package for authentication.

It replaces the previous NextAuth integration completely.

## High-level architecture

- **Better Auth API** lives under `GET/POST /api/auth/*` (Next.js App Router handler).
- **Sessions** are cookie-based.
- **Database**: Better Auth stores users/sessions/accounts in **Supabase Postgres** (same project as the rest of SmartDeploy) via `DATABASE_URL`.
- **Sign-in methods**:
  - Email/password (enabled)
  - Social OAuth providers (enabled only when env credentials exist)

## Key files

- **Server config**: `src/lib/auth.ts`
  - Creates the Better Auth instance via `betterAuth()`
  - Uses `nextCookies()` plugin so server actions/handlers can set auth cookies
  - Uses `DATABASE_URL` (Supabase Postgres) when provided; otherwise falls back to stateless mode (useful in unit tests)
- **Client**: `src/lib/auth-client.ts`
  - `createAuthClient()` from `better-auth/react`
  - Used by UI components to sign in/out and read the session
- **Route handler**: `src/app/api/auth/[...all]/route.ts`
  - Mounts Better Auth for Next.js via `toNextJsHandler(auth)`
- **Request gate**: `src/proxy.ts`
  - Enforces “must be signed in” for protected pages
  - Enforces “must be approved” (allowlist) using Supabase `approved_users`

## Environment variables

Required:

- `BETTER_AUTH_SECRET`: cookie signing + encryption secret (32+ chars).
- `BETTER_AUTH_URL`: base URL of the app (used for callbacks/redirects).
- `DATABASE_URL`: Supabase Postgres connection string (server-only). On IPv4-only networks, use the dashboard **Session pooler** URI instead of the direct `db.*.supabase.co` host; see `docs/SUPABASE_SETUP.md`.
- `SUPABASE_URL`: Supabase project URL (HTTP API).
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (server-only).

Optional (social sign-in):

- GitHub: `GITHUB_ID`, `GITHUB_SECRET`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

Notes:

- Social providers are **only enabled** when both client id + secret exist.
- Never expose `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` to the browser.

## Database tables created by Better Auth

When you run migrations, Better Auth creates core tables such as:

- `user`
- `session`
- `account`
- `verification`

Depending on enabled features/plugins, additional tables may exist.

### Security hardening (Supabase)

Better Auth tables are not meant to be queried from the browser via Supabase PostgREST.
To prevent access by Supabase API roles, revoke privileges for `anon` and `authenticated`.

See `docs/SUPABASE_SETUP.md` for the recommended SQL.

## Running migrations

This repo includes a helper script:

```bash
npm run auth:migrate
```

Which runs:

```bash
npx auth@latest migrate
```

This applies Better Auth’s schema to the Postgres database referenced by `DATABASE_URL` (your Supabase project DB).

## How sessions are accessed

### Server-side (Route handlers / Server Components)

Use the Better Auth server instance:

- File: `src/lib/auth.ts`
- API: `auth.api.getSession({ headers })`

Example pattern:

```ts
import { auth } from "@/lib/auth";

const session = await auth.api.getSession({ headers: request.headers });
const userId = session?.user?.id;
```

### Client-side (React)

Use the Better Auth client:

- File: `src/lib/auth-client.ts`
- Hook: `authClient.useSession()`

Example pattern:

```ts
import { authClient } from "@/lib/auth-client";

const { data: session, isPending } = authClient.useSession();
```

## Sign-in flows

### Email/password

Enabled in `src/lib/auth.ts`:

- `emailAndPassword: { enabled: true }`

The UI calls:

- `authClient.signIn.email({ email, password, callbackURL })`

### Social (Google/GitHub)

Enabled in `src/lib/auth.ts` only when credentials exist.

The UI calls:

- `authClient.signIn.social({ provider: "google" | "github", callbackURL })`

## GitHub token handling (important)

SmartDeploy has features that require a GitHub OAuth token (repo scanning, repo syncing, deployments).

Because users can sign in with **email/password** or **Google**, a GitHub token is **not always available**.

Current approach:

- The app reads the user session (Better Auth).
- When a GitHub token is needed, the server looks up the user’s GitHub OAuth token from the Better Auth `account` table:
  - `src/lib/githubAccessToken.ts`
- If no GitHub account is linked, API routes/resolvers return a clear error like **“GitHub not connected”**.

## Repo selection with empty repos + manual URLs

- The UI supports entering a repo URL (useful when repo lists are empty or GitHub isn’t connected).
- Service detection tolerates **empty repositories** (GitHub returns a 409 for archive downloads).
  - `src/lib/githubRepoArchive.ts` treats empty repos as an empty workspace and returns 0 detected services.

## Troubleshooting

### “GitHub not connected”

You’re signed in via email/password or Google, but you haven’t connected GitHub.
Sign in with GitHub (or add account linking) before using GitHub-required features.

### Migrations fail

Most common causes:

- `DATABASE_URL` password is wrong (reset in Supabase dashboard).
- Network/IP restrictions prevent connecting to Supabase Postgres.

### Approval redirect to `/waiting-list`

SmartDeploy uses an allowlist:

- allowed emails: `approved_users`
- unapproved attempts: `waiting_list`

This is enforced in `src/proxy.ts`.

