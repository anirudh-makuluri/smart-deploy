# Environment Variables

Smart Deploy uses env vars at **build time** (CodeBuild) and **runtime** (ECS tasks). Static S3 deploys only use build-time vars during the build step.

## Build-time vs runtime

| Phase | Used for | ECS deploys | Static S3 |
|-------|----------|-------------|-----------|
| **Build-time** | `npm ci`, `npm run build`, Railpack install | Injected into CodeBuild as `.env` | Same |
| **Runtime** | App process after container starts | AWS Secrets Manager → ECS task env | N/A (static files only) |

Changing runtime vars in the UI updates Secrets Manager but the running task may need a **redeploy** to pick up new values.

## Where to set them

- **Blueprint preview** or **Config → Environment** tab
- Format: `KEY=value` per line; lines starting with `#` are ignored

## ECS runtime secrets

For container deploys, runtime env vars are stored in **AWS Secrets Manager** per deployment (`secretsArn`). Smart Deploy syncs your env string to the secret and mounts keys on the ECS task definition.

Do not put build-only secrets in runtime if the build step needs them — use build-time vars for CodeBuild.

## Common variables

| Variable | When needed |
|----------|-------------|
| `PORT` | Container must listen on the port ECS expects (often from scan/Railpack plan) |
| `NODE_ENV` | `production` for Node server apps |
| `DATABASE_URL` | Runtime connection string for server apps |
| `RAILPACK_PACKAGES` | Pin Mise packages at build: `node@22` |
| `RAILPACK_SPA_OUTPUT_DIR` | Monorepo SPA dist path for static routing |
| `RAILPACK_BUILD_CMD` / `RAILPACK_START_CMD` | Override Railpack commands |

See [Railpack](./RAILPACK.md).

## Railpack plan variables

Railpack may embed `deploy.variables` in the scan plan. User env vars in Smart Deploy merge with build context — conflicting keys: prefer explicit env tab values for overrides.

## Build-time `.env` in CodeBuild

During build, Smart Deploy writes your env string to `.env` in the CodeBuild workspace before Railpack/Docker build runs. Useful for:

- `NEXT_PUBLIC_*` vars needed at build
- Private registry tokens for `npm`/`pip`
- Build-args equivalents for static site builds

## Static sites

Only build-time vars apply. There is no server process — anything the built HTML/JS needs at build time must be present during CodeBuild.

## Security practices

- Never commit production secrets to the repo; use Smart Deploy env vars or Secrets Manager
- Rotate credentials if logs show leaked values
- Separate staging and production deployments rather than reusing secrets across branches

## Troubleshooting

| Symptom | Check |
|---------|-------|
| App missing config at runtime | Runtime env tab; redeploy after changes |
| Build can't reach private npm | Build-time token vars |
| Wrong API URL in built SPA | `NEXT_PUBLIC_*` at build time, not runtime |
| Container exits immediately | Required runtime vars (`DATABASE_URL`, `PORT`) |

## Related

- [Railpack](./RAILPACK.md)
- [Startup and Runtime Failures](./STARTUP_AND_RUNTIME_FAILURES.md)
- [Build Failures](./BUILD_FAILURES.md)