# Railpack

**Railpack** is the default build system for most apps on Smart Deploy. It generates a build plan at scan time and produces a container image at deploy time — without you writing a Dockerfile.

Smart Deploy does not call Railpack directly in the UI. SD Artifacts runs Railpack during Smart Analysis; CodeBuild executes the plan during deploy.

## Railpack + Mise

[Railpack is built on Mise](https://railpack.com/config/mise/). Mise manages language runtimes and tools inside the built image:

- Auto-detects version files: `.node-version`, `.python-version`, `mise.toml`, `.tool-versions`, `.nvmrc`, `.go-version`, etc.
- Installs the correct Node, Python, Ruby, Go, and other toolchains during the install step
- Railpack writes global Mise config to `/etc/mise/config.toml` in the image; your repo's `mise.toml` can override it

You typically configure runtimes via repo files rather than touching Mise directly.

## Railpack plan structure

Stored in scan results as `railpack_plan`:

```json
{
  "steps": [
    { "name": "install", "commands": [{ "cmd": "npm ci" }] },
    { "name": "build", "commands": [{ "cmd": "npm run build" }] }
  ],
  "deploy": {
    "startCommand": "npm run start",
    "variables": {}
  }
}
```

| Part | Role |
|------|------|
| `steps[].install` | Dependencies and toolchain setup |
| `steps[].build` | Compile or bundle the app |
| `deploy.startCommand` | Container command on ECS; also determines ECS vs S3 for `static_build` |
| `deploy.variables` | Build-time variables embedded in the plan |

## Three build paths

| Path | When |
|------|------|
| **Railpack → ECS** | Server apps, static with runtime, most monorepo services |
| **Railpack → S3** | `static_build` with no `deploy.startCommand` |
| **Dockerfile → ECS** | `existing_docker` — repo Dockerfile, Railpack skipped |

## How deploy uses the plan

CodeBuild:

1. Decodes the Railpack plan JSON from the scan
2. Runs `docker buildx build -f /tmp/railpack-plan.json`
3. Pushes the image to ECR

ECS runs `deploy.startCommand` as the container entrypoint.

## Editing commands

From scan results you can override install, build, and start commands before deploy. Changes update the in-session plan used for the next deploy.

Prefer fixing the repo (scripts, `package.json`, version files) when overrides are a temporary workaround.

## Railpack environment variables

Set these in Smart Deploy env vars (build-time unless noted):

| Variable | Description |
|----------|-------------|
| `RAILPACK_PACKAGES` | Extra Mise packages: `node@22 python@3.12 jq@latest` |
| `RAILPACK_INSTALL_CMD` | Override install step |
| `RAILPACK_BUILD_CMD` | Override build step |
| `RAILPACK_START_CMD` | Override start command |
| `RAILPACK_BUILD_APT_PACKAGES` | Extra apt packages at build time |
| `RAILPACK_DEPLOY_APT_PACKAGES` | Extra apt packages in final image |
| `RAILPACK_SPA_OUTPUT_DIR` | Monorepo SPA output path for static artifact routing |

See [Railpack env var docs](https://railpack.com/config/environment-variables/).

## Version pinning

| Method | Example |
|--------|---------|
| `.node-version` | `22` |
| `.python-version` | `3.12` |
| `mise.toml` | `[tools] node = "22"` |
| `RAILPACK_PACKAGES` | `node@22` in env vars |

Wrong runtime version after deploy? Check these before overriding commands.

## Common issues

| Symptom | Check |
|---------|-------|
| Build fails at `npm ci` / `pip install` | Dependency files, lockfiles, private registry tokens |
| Wrong Node/Python | Version files, `RAILPACK_PACKAGES`, `mise.toml` |
| No start command on SPA | Expected for S3 path; add start command if you need ECS runtime |
| Plan missing | Re-run Smart Analysis; check classifier logs |

See [Build Failures](./BUILD_FAILURES.md).

## Related

- [Smart Analysis](./SMART_ANALYSIS.md)
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)
- [Deployment Pipeline](./DEPLOYMENT_PIPELINE.md)