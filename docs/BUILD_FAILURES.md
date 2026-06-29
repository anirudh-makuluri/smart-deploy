# Build Failures

Build failures happen during **CodeBuild** (deploy step `build` or `publish`). The image or static artifact never reaches production.

## First steps

1. Open **Deployment History** → failed run → **Build** step logs
2. Find the first failing command (npm, pip, docker, railpack)
3. Check scan **build_status** — did Smart Analysis verification pass?
4. If plan-related → **Improve scan** before redeploy

## Failure code

Most build failures map to:

**`CODEBUILD_DOCKER_IMAGE_BUILD_FAILED`**

Exact log strings:

- `Docker image build failed. Check build logs above.`
- `CodeBuild failed: Docker image build did not succeed`

## Railpack build failures

CodeBuild runs:

```text
docker buildx build -f /tmp/railpack-plan.json ...
```

| Cause | What to check |
|-------|---------------|
| Dependency install failed | Lockfile committed, registry auth env vars, Node/Python version files |
| Build script failed | `npm run build` errors locally at same commit |
| Missing files | Monorepo `package path` — wrong service root |
| Railpack plan empty | Re-run Smart Analysis |

See [Railpack](./RAILPACK.md) and [Smart Analysis](./SMART_ANALYSIS.md).

## Dockerfile failures (`existing_docker`)

| Cause | What to check |
|-------|---------------|
| Wrong context | Dockerfile path matches selected service directory |
| Base image pull failed | Docker Hub rate limit — platform may need registry credentials |
| Multi-stage copy fails | Paths relative to build context |

## Docker Hub rate limits

Anonymous pulls in CodeBuild can hit 429 errors. Symptoms in logs: rate limit, 429, toomanyrequests.

Retry after a cooldown or ensure build uses authenticated registry pulls via env configuration.

## Static build failures

S3-targeted builds fail when:

- Build command does not produce expected output directory
- `RAILPACK_SPA_OUTPUT_DIR` wrong for monorepo SPA
- Build-time env vars missing (`NEXT_PUBLIC_*`)

## Scan verification vs deploy build

| Phase | When |
|-------|------|
| Scan `build_verification` | During Smart Analysis (SD Artifacts) |
| CodeBuild | During deploy |

Verification can pass but deploy build fail if branch/commit/env differ. Align branch and env vars between scan and deploy.

## Fix checklist

- [ ] Reproduce build locally at the same commit
- [ ] Confirm version files (`.node-version`, `mise.toml`) match expected runtime
- [ ] Confirm env vars needed at build time are set in Smart Deploy
- [ ] For monorepos, confirm correct package path / service
- [ ] Run Improve scan if Railpack plan looks wrong
- [ ] Redeploy after fixes

## Related

- [Railpack](./RAILPACK.md)
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)
- [Error Catalog](./ERROR_CATALOG.md)
- [Deployment Logs](./DEPLOYMENT_LOGS.md)