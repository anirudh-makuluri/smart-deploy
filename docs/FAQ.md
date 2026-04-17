# FAQ

## What is Smart Deploy?
Smart Deploy is a deployment platform that helps you inspect infrastructure before deployment. It sits between a traditional PaaS and manual cloud setup.

See [README](../README.md).

## Which cloud providers are supported?
AWS and GCP deployment paths are supported.

See [AWS Setup](./AWS_SETUP.md) and [GCP Setup](./GCP_SETUP.md).

## Do I need Docker to use Smart Deploy?
For local and self-hosted flows, Docker is commonly used, especially with `docker compose` and worker operations.

## Why do I need Supabase?
Supabase provides the primary Postgres database for users, deployments, history, and repo metadata.

See [Supabase Setup](./SUPABASE_SETUP.md).

## Why am I sent to `/waiting-list` after sign-in?
Smart Deploy uses an allowlist. Your email must exist in `approved_users`.

See [Troubleshooting](./TROUBLESHOOTING.md#sign-in-succeeds-but-redirected-to-waiting-list).

## Can I sign in without GitHub?
Yes, but GitHub-dependent features (repo scanning, syncing, deployments based on GitHub repos) require a linked GitHub account/token.

See [Better Auth](./BETTER_AUTH.md#github-token-handling-important).

## What are the minimum environment variables to run locally?
At minimum:
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_WS_URL`
- GitHub OAuth variables for GitHub sign-in

See [README Quick Start](../README.md#4-configure-environment-variables).

## What is the WebSocket worker for?
The worker handles long-running deploy jobs, log streaming, and related background operations.

See [README Architecture Overview](../README.md#architecture-overview).

## Why are deploy logs not updating in real time?
Usually a WebSocket configuration issue. Check worker status and `NEXT_PUBLIC_WS_URL`.

See [Troubleshooting](./TROUBLESHOOTING.md#websocket-not-connecting).

## How do I run app and worker together in development?
Use:
```bash
npm run start-all
```

## How do I self-host Smart Deploy?
Use the EC2 self-hosting flow and provided scripts.

See [Self Hosting](./SELF_HOSTING.md).

## How do I enable HTTPS on self-hosted deployment?
Use the SSL setup script on your host:
```bash
sudo ./scripts/setup-ssl.sh
```

See [Self Hosting](./SELF_HOSTING.md#3-set-up-ssl-lets-encrypt).

## Can Smart Deploy manage custom-domain DNS automatically?
Yes, if your DNS is managed by Vercel and you configure `VERCEL_TOKEN` and related vars.

See [Custom Domains](./CUSTOM_DOMAINS.md).

## Does Smart Deploy support multi-service repositories?
Yes. It detects service catalogs and deploy-time service structure using repo layout and tooling heuristics.

See [Multi-service Detection](./MULTI_SERVICE_DETECTION.md).

## What should I do if AWS deploy fails with IAM errors?
Confirm IAM policy permissions and region/certificate alignment.

See [AWS Setup](./AWS_SETUP.md#troubleshooting).

## What should I do if GCP deploy fails?
Verify required APIs, service account roles, and `gcloud` availability.

See [GCP Setup](./GCP_SETUP.md#troubleshooting).

## Why do database migrations fail on local machines sometimes?
On IPv4-only networks, direct Supabase DB host can fail. Session Pooler URI is usually more reliable for `DATABASE_URL`.

See [Supabase Setup](./SUPABASE_SETUP.md#supabase-postgres-connection-string-for-better-auth).

## Where can I see all scripts and what they do?
See the scripts section in:
- [README](../README.md#scripts)
- [Self Hosting](./SELF_HOSTING.md#helper-scripts)

## Is there a single place to start when I am stuck?
Yes, start with [Troubleshooting](./TROUBLESHOOTING.md).
