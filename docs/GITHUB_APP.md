# GitHub App integration

SmartDeploy uses a GitHub App for browser sign-in, read-only repository access, and automated deployments from GitHub push events.

## Required App settings

- Callback URL: `https://smart-deploy.xyz/api/auth/callback/github` in production.
- Webhook URL: `https://smart-deploy.xyz/api/github/webhook` in production.
- Repository permission: **Contents: Read-only**.
- Account permission: **Email addresses: Read-only**.
- Webhook event: **Push**.
- Enable expiring user authorization tokens.
- Do not enable Device Flow or request user authorization during installation.

Use a separate GitHub App for local development. Its callback URL is `http://localhost:3000/api/auth/callback/github`. A local webhook still needs an HTTPS tunnel because GitHub cannot deliver webhooks to localhost.

## Server environment

Set these values in each environment. Never expose them with a `NEXT_PUBLIC_` prefix.

```dotenv
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY_BASE64=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_SLUG=
```

`GITHUB_APP_PRIVATE_KEY_BASE64` is the Base64 encoding of the downloaded PEM private-key file. `GITHUB_APP_ID` is the numeric App ID, not the Client ID.

## Apply the database change

Apply the `github_webhook_deliveries` table and index block from the current [`supabase/schema.sql`](../supabase/schema.sql) in Supabase before enabling webhook delivery. The table ensures GitHub retries do not create duplicate deployments.

## Deployment behavior

After a user has completed an initial deployment, SmartDeploy treats its saved configuration as an approved deployment configuration. A verified `push` event queues each matching live deployment whose configured branch equals the pushed branch. The queue stores the event commit SHA and GitHub App installation ID; the deployment worker then creates a short-lived installation token and builds that exact commit.

Draft, paused, failed, and stopped deployments are not triggered by a push. While a deployment is already active, another push for the same service is skipped rather than running concurrently.
