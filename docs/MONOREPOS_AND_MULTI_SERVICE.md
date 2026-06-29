# Monorepos and Multi-Service

Smart Deploy detects multiple deployable units in one repository and lets you deploy each as a separate service with its own scan, config, and URL.

## How services are discovered

The service catalog merges several sources (in order):

1. **Docker Compose directories** — one catalog row per compose folder (collapsed for UI)
2. **Monorepo packages** — `apps/*`, `services/*`, `packages/*`, `modules/*`, `projects/*` when workspace tooling exists
3. **Dockerfile directories** — any folder with a `Dockerfile`
4. **Root siblings** — immediate subdirs like `api/` + `web/` without a root workspace
5. **Root app** — optional extra row when the repo root is also an app

Libraries under `packages/*` without `start`, `serve`, or `dev` scripts are skipped.

## Monorepo indicators

Detection runs when the repo root has:

- `pnpm-workspace.yaml`, or
- `package.json` with `workspaces`, or
- `turbo.json`, `nx.json`, or `lerna.json`

## Deploying a specific package

Each service row has a **package path** (for example `apps/web`). Smart Analysis scopes the scan to that path:

- Classifier and Railpack prepare target the package directory
- Deploy units filter to services under that path
- You get a separate deployment, subdomain, and history per service

## Multi-service compose repos

| UI catalog | Deploy-time behavior |
|------------|---------------------|
| One row per compose directory | May expand to one deploy unit per compose service |
| Collapsed summary in repo cards | Full unit list in scan `deploy_units` |

Root compose with app + database services: database-only compose services are filtered out.

## Multiple services, multiple URLs

Each service gets:

- Its own `serviceName` (for example `web`, `api`)
- Its own hosted subdomain (must be unique on the platform)
- Its own ALB host rule: `https://{subdomain}.{domain}`

Plan subdomains before deploying several services from one monorepo.

## Choosing ECS vs S3 per service

Routing is per service based on that service's scan:

- Frontend `static_build` without start command → S3
- API `server` shape → ECS
- Mixed monorepos commonly have both targets in one repo

## Adding a service manually

You can add a repo-relative directory as a new service root. Smart Deploy validates the path and infers language/framework for that folder.

## Tips

| Scenario | Recommendation |
|----------|----------------|
| Turborepo `apps/web` + `apps/api` | Deploy each app as its own service |
| Compose at repo root | One catalog entry; review expanded units in scan |
| Only want one service from a big repo | Select the right package path before scanning |
| Shared env vars | Set per deployment; no automatic sharing across services |

## Related

- [Smart Analysis](./SMART_ANALYSIS.md)
- [Railpack](./RAILPACK.md) — `RAILPACK_SPA_OUTPUT_DIR` for monorepo SPAs
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)