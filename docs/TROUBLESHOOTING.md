# Troubleshooting

This guide is for quick unblock when something is failing in Smart Deploy.

Use this format:
1. Find the symptom that matches your issue.
2. Run the quick checks.
3. Apply the fix.

If you are self-hosting, also see [Self Hosting](./SELF_HOSTING.md).
For frequent deploy-time failures, see [Error Catalog](./ERROR_CATALOG.md#common-deployment-failures-high-frequency).

---

## App does not start locally

### Symptoms
- `npm run dev` fails
- `npm run start-all` exits immediately
- Browser shows `localhost:3000` unavailable

### Quick checks
```bash
npm install
npm run dev
```

Verify required env vars in `.env`:
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_WS_URL`

### Fix
- Copy `.env.example` to `.env` and fill required values.
- If dependencies are out of sync, remove `node_modules` and reinstall.

---

## Sign in succeeds but redirected to waiting list

### Symptoms
- You can authenticate, then land on `/waiting-list`

### Cause
- Your email is not in `approved_users`.

### Fix
Run in Supabase SQL editor:
```sql
insert into public.approved_users (email, name)
values ('you@example.com', 'Your Name')
on conflict (email)
do update set name = excluded.name;
```

---

## "GitHub not connected"

### Symptoms
- Repo scanning or deploy actions fail with "GitHub not connected"

### Cause
- User session has no linked GitHub OAuth account/token.

### Fix
- Sign in with GitHub.
- If signed in with email/password or Google only, connect GitHub and retry.

Also see [Better Auth](./BETTER_AUTH.md).

---

## Supabase connection errors

### Symptoms
- `getaddrinfo ENOTFOUND`
- DB unreachable
- Migration failures
- "relation does not exist"

### Quick checks
- Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Confirm `DATABASE_URL` is valid.

### Fix
- For IPv4-only networks, use Supabase Session Pooler URI for `DATABASE_URL`.
- Run auth migration and then schema migration in order:
  1. `npm run auth:migrate`
  2. execute `supabase/schema.sql` in Supabase SQL editor

Also see [Supabase Setup](./SUPABASE_SETUP.md).

---

## WebSocket not connecting

### Symptoms
- Status badge shows degraded
- Deploy logs do not stream
- Worker appears offline

### Quick checks
- Local dev: `NEXT_PUBLIC_WS_URL=ws://localhost:4001`
- Production HTTPS: `NEXT_PUBLIC_WS_URL=wss://<your-domain>/ws`
- Worker is running: `npm run ws` (dev) or container is healthy (Docker)

### Fix
- Set correct `NEXT_PUBLIC_WS_URL` for your environment.
- Ensure reverse proxy passes `/ws` to worker.
- If split deployment, verify `WS_ALLOWED_ORIGINS` on worker includes frontend origin.

---

## AWS deploy fails with permission errors

### Symptoms
- `UnauthorizedOperation`
- `ec2:RunInstances` denied
- `ec2:CreateTags` denied
- CodeBuild role creation fails

### Fix
- Ensure IAM policy includes required EC2, ALB, SSM, CodeBuild, ECR, IAM, STS permissions.
- If using ALB HTTPS, verify `EC2_ACM_CERTIFICATE_ARN` is issued and in the same `AWS_REGION`.

Also see [AWS Setup](./AWS_SETUP.md).

---

## GCP deploy fails

### Symptoms
- Cloud Run deploy denied
- Cloud SQL API errors
- `gcloud: command not found`

### Fix
- Enable required APIs:
  - `run.googleapis.com`
  - `cloudbuild.googleapis.com`
  - `artifactregistry.googleapis.com`
  - `logging.googleapis.com`
  - `sqladmin.googleapis.com` (if using Cloud SQL)
- Ensure service account has required roles.
- Install `gcloud` CLI on the worker host/image.

Also see [GCP Setup](./GCP_SETUP.md).

---

## Custom domain does not resolve or TLS fails

### Symptoms
- Visit URL does not load
- DNS record missing
- HTTPS certificate issues

### Quick checks
- `NEXT_PUBLIC_DEPLOYMENT_DOMAIN` is set.
- If using Vercel DNS automation, `VERCEL_TOKEN` and `VERCEL_DOMAIN` are set.
- For AWS HTTPS, `EC2_ACM_CERTIFICATE_ARN` is valid and issued.

### Fix
- Create or correct CNAME records manually if not using Vercel automation.
- Wait for DNS propagation.
- Re-run deployment after DNS and certificate are valid.

Also see [Custom Domains](./CUSTOM_DOMAINS.md).

---

## Self-hosted instance runs out of memory

### Symptoms
- Docker build killed
- Next.js build fails unexpectedly on small EC2 instances

### Fix
- On low-memory hosts, add swap:
```bash
sudo ./scripts/setup-swap.sh
```
- Set Node heap in `.env`:
```bash
NODE_MAX_OLD_SPACE_SIZE=2048
```

Also see [Self Hosting](./SELF_HOSTING.md).

---

## Nginx 502 on self-hosted setup

### Symptoms
- Nginx responds but upstream app is unavailable

### Quick checks
```bash
docker compose ps
docker compose logs
```

### Fix
- Wait for containers to finish booting.
- Verify `.env` is present and complete.
- Restart services after fixing config:
```bash
docker compose restart
```

---

## Still blocked?

Collect this before asking for help:
1. Exact error text.
2. Last action performed.
3. Relevant environment (`local`, `self-hosted EC2`, `split deploy`).
4. Output of:
```bash
npm run dev
npm run ws
```
or for Docker:
```bash
docker compose ps
docker compose logs
```
