# smart-deploy ↔ sd-artifacts integration

This document is the **implementation spec** for smart-deploy consuming the sd-artifacts **analyze API** (Railpack-backed `deploy_units`, `railpack_plan`, etc.). Give this file to your coding agent working on smart-deploy.

---

## 1. Migration from file-based artifacts

sd-artifacts no longer returns generated Dockerfiles, compose, or nginx as the primary contract. smart-deploy should assume the **current** analyze response shape below.

| Legacy smart-deploy expectations | Current sd-artifacts (use instead) |
|----------------------------------|-------------------------------------|
| Generated `Dockerfile` text | `deploy_units[].artifacts.railpack_plan` (JSON build plan) |
| Generated `docker-compose.yml` | Not produced — deploy orchestration is smart-deploy's job |
| Generated `nginx.conf` | Not produced |
| Generated shell `commands` block | Commands live inside `railpack_plan.steps[]` and `deploy.startCommand` |
| `service_name` in cache key / API | **Removed** — cache key is `(repo_url, commit_sha, package_path)` only |
| File-bundle / schema markers as gate | **`deploy_units`** + Railpack fields drive UI and deploy branching |
| Build verify against Dockerfile | Build verify via **Railpack CLI** on sd-artifacts host |
| Planner / verifier / preflight nodes | **Railpack prepare + build + AI repair** pipeline |

**Bottom line for smart-deploy:** stop rendering or applying Dockerfile/compose/nginx artifacts. Clone the repo, pick the correct build context directory per deploy unit, and build with Railpack's BuildKit frontend using the cached `railpack_plan`.

---

## 2. sd-artifacts pipeline (context)

```
scanner → clone_repo → classifier → railpack_prepare → deploy_briefing → railpack_build_repair → finalize
```

| Node | What smart-deploy cares about |
|------|-------------------------------|
| `scanner` | Resolves `commit_sha`, may return cached analyze result immediately |
| `classifier` | Sets `deploy_shape` and `deploy_units[]` |
| `railpack_prepare` | Fills `deploy_units[].artifacts.railpack_plan` |
| `deploy_briefing` | Fills human-readable `deploy_briefing` markdown for UI |
| `railpack_build_repair` | Runs `railpack build`, sets `build_status`, may patch `railpack_json` |
| `finalize` | Sets `schema_version`, `workflow_version`, final `build_status` |

**Feedback sub-pipeline** (no rescan):

```
clone_repo → railpack_build_repair → finalize
```

---

## 3. API reference

**Base URL:** your sd-artifacts deployment (e.g. `https://sd-artifacts.example.com`)

**Auth:** all endpoints except `GET /health` require:

```http
Authorization: Bearer <SD_API_BEARER_TOKEN>
```

### 3.1 `POST /analyze`

Primary entry point.

**Request body:**

```json
{
  "repo_url": "https://github.com/org/repo",
  "package_path": "apps/web",
  "github_token": "optional-for-private-repos",
  "max_files": 50,
  "commit_sha": "optional-for-cache-lookup",
  "refresh": false
}
```

| Field | Notes |
|-------|-------|
| `repo_url` | Full GitHub HTTPS URL |
| `package_path` | Subdirectory scope; `"."` for repo root (may hit scope guard on large monorepos) |
| `commit_sha` | If provided **and** `refresh` is false, returns Supabase cache hit without re-running pipeline |
| `refresh` | `true` = bypass cache, re-run full pipeline, upsert cache row |
| `github_token` | Passed through for private repo clone/scan |

**Success:** `200` with `AnalyzeResponse` (see §4).

**Errors:**

| Status | When |
|--------|------|
| `400` | Scanner/classifier/clone failure; body is string or `{ "code": "...", "reason": "..." }` |
| `401` | Missing/invalid bearer token |
| `503` | Supabase or auth not configured on server |

**Scope guard** (root analysis only): if repo is too large and `package_path` is `"."`, returns `400`:

```json
{
  "code": "scope_required",
  "reason": "Repository scope is too broad for root analysis. Specify package_path to narrow analysis.",
  "tree_entry_count": 7000,
  "candidate_package_count": 35,
  "suggested_package_paths": ["apps/web", "apps/api", "..."]
}
```

smart-deploy should prompt the user to pick a `package_path` from `suggested_package_paths`.

### 3.2 `POST /analyze/stream`

Same request body as `/analyze`. Returns **Server-Sent Events**:

| Event | Payload |
|-------|---------|
| `progress` | `{"node": "scanner\|clone_repo\|classifier\|railpack_prepare\|deploy_briefing\|railpack_build_repair\|finalize", "status": "completed"}` |
| `complete` | Full `AnalyzeResponse` JSON |
| `error` | `{"detail": "..."}` |

Use for dashboard progress UI during long Railpack builds.

### 3.3 `POST /feedback` and `POST /feedback/stream`

Iterative build repair on an **existing cached** analysis. Does **not** rescan or regenerate briefing from scratch.

**Request:**

```json
{
  "repo_url": "https://github.com/org/repo",
  "commit_sha": "abc123...",
  "package_path": "apps/backend",
  "feedback": "Use CGO_ENABLED=0 and build ./cmd/server instead",
  "github_token": "optional"
}
```

**Requires:** prior `/analyze` cached row for exact `(repo_url, commit_sha, package_path)`.

**Returns:** updated `AnalyzeResponse` with new `repair_history`, `build_status`, and possibly updated `railpack_plan` / `railpack_json`.

Feedback stream nodes: `clone_repo`, `railpack_build_repair`, `finalize`.

### 3.4 `DELETE /cache`

Invalidate cached analysis.

```json
{
  "repo_url": "https://github.com/org/repo",
  "commit_sha": "optional",
  "package_path": "apps/web"
}
```

### 3.5 `POST /responses/status`

Audit / quality signal after a deploy attempt.

```json
{
  "response_id": "uuid-from-analyze-response",
  "passed": false
}
```

When `passed: false`, sd-artifacts **deletes** the matching `analysis_cache` row so the next analyze re-runs the pipeline.

### 3.6 `GET /health` / `GET /healthz`

Health check. `/healthz` requires auth.

---

## 4. Response schema (`AnalyzeResponse`)

smart-deploy should treat payloads with **`deploy_units`** as the default analyze shape (normalize into `SDArtifactsResponse`, gate deploy on `build_status`, etc.). sd-artifacts may still include a `schema_version` field on the wire; smart-deploy does not need to branch on it.

```typescript
type BuildStatus =
  | "passed"      // all units built successfully on sd-artifacts
  | "failed"      // all attempted units failed
  | "partial"     // some units passed, some failed (multi)
  | "skipped"     // railpack CLI unavailable; no build run
  | "error"       // pipeline error
  | "not_run";    // build never attempted

type DeployShape =
  | "static"           // plain HTML, no build step
  | "static_build"     // Vite/Next/Astro/etc — build artifacts, may lack start cmd
  | "server"           // long-running app (Node/Python/Go)
  | "multi"            // multiple workspace sub-packages detected
  | "existing_docker"; // Dockerfile already in repo — skip Railpack

interface AnalyzeResponse {
  schema_version: 2; // informational from sd-artifacts; smart-deploy keys off deploy_units
  response_id: string;           // UUID — store for /responses/status
  commit_sha: string;
  package_path: string;          // normalized, e.g. "apps/web"
  deploy_shape: DeployShape;
  railpack_version: string | null;  // e.g. "0.26.1" — PIN frontend to this
  workflow_version: string | null;  // e.g. "sd-artifacts@2026-06-04"
  build_status: BuildStatus;

  deploy_units: DeployUnit[];
  deploy_briefing: string;       // markdown for operators
  build_verification: BuildVerification;
  repair_history: RepairAttempt[];
  pipeline_trace: PipelineTraceEntry[];
  errors: string[];
  llm_outputs: Record<string, unknown>;
  inputs_snapshot: Record<string, unknown>;  // includes repo_scan
  token_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}

interface DeployUnit {
  name: string;                  // e.g. "dashboard", "backend"
  root: string;                  // path relative to repo root, e.g. "apps/dashboard"
  type: string;                  // "server" | "static_build" | "static" | "existing_docker"
  provider: string;              // "node" | "python" | "go" | "static" | "unknown"
  framework: string | null;      // "vite" | "next" | "express" | null
  port: number;                  // heuristic default, e.g. 3000, 8080
  artifacts: {
    railpack_plan: RailpackPlan | null;
    railpack_json: Record<string, unknown> | null;  // merged overrides from repair
  };
}

interface BuildVerification {
  backend: "railpack";
  status: string;                // mirrors build_status
  message: string;
  attempts: number;
  duration_seconds: number;
  log_excerpt: string;
}

interface RepairAttempt {
  attempt: number;
  unit_name: string;
  diagnosis: string;
  patch: {
    railpack_json?: Record<string, unknown>;
    env_overrides?: Record<string, string>;
    should_retry?: boolean;
    give_up_reason?: string | null;
  };
  railpack_json_after_merge: Record<string, unknown> | null;
  build_log_excerpt: string;
  build_exit_code: number | null;
  duration_seconds: number;
  result: "passed" | "failed";
}
```

### 4.1 `railpack_plan` structure (subset)

sd-artifacts validates plans exist after `railpack prepare`. smart-deploy reads:

```typescript
interface RailpackPlan {
  steps?: Array<{
    name: string;
    commands?: Array<{ cmd: string }>;
  }>;
  deploy?: {
    startCommand?: string;
    variables?: Record<string, string>;  // default env vars Railpack detected
  };
}
```

Extract helpers (same logic sd-artifacts uses internally):

```typescript
function getStartCommand(plan: RailpackPlan | null): string | undefined {
  return plan?.deploy?.startCommand;
}

function getPlanCommands(plan: RailpackPlan | null): Array<{ step: string; cmd: string }> {
  const out: Array<{ step: string; cmd: string }> = [];
  for (const step of plan?.steps ?? []) {
    for (const entry of step.commands ?? []) {
      if (entry.cmd?.trim()) out.push({ step: step.name, cmd: entry.cmd.trim() });
    }
  }
  return out;
}
```

**Note:** `railpack_target` (workspace build dir, filter commands) is computed internally during analysis but **stripped from the public API response**. smart-deploy must derive build context using the rules in §6.

---

## 5. Deploy shapes — what smart-deploy should do

| `deploy_shape` | Units | smart-deploy action |
|----------------|-------|---------------------|
| `server` | 1 | Build image via Railpack, run as container/service with `startCommand` |
| `static_build` | 1 | Build via Railpack; may have **no** `startCommand` — serve static output (see §7) |
| `static` | 1 | Serve static files (no Railpack build, or minimal) |
| `multi` | 2+ | Deploy each unit separately (multiple services) |
| `existing_docker` | 1 | **Do not use Railpack** — `docker build` the repo's existing Dockerfile at `root` |

### 5.1 When to block deploy

| `build_status` | Recommendation |
|----------------|----------------|
| `passed` | Safe to proceed (plan was verified on sd-artifacts) |
| `partial` | Proceed with caution for passed units; surface failures for failed units |
| `failed` | Block auto-deploy; offer `/feedback` or manual fix |
| `skipped` | sd-artifacts had no Railpack CLI — plan may exist but unverified; warn user |
| `not_run` / `error` | Block; show `errors[]` and `deploy_briefing` |

Treat `build_status` as a **gate**, not a suggestion. sd-artifacts already spent up to 3 AI repair attempts per unit.

### 5.2 `deploy_briefing` (UI)

Markdown document for humans. Expected sections:

```
# Deploy briefing
## Overview
## Build & run
## Ports & networking
## Environment variables
## Risks & caveats
```

Render in smart-deploy's review UI. It summarizes Railpack steps, ports, and env vars. LLM-generated with deterministic fallback if LLM fails.

**Timing note:** briefing is generated **after** `railpack_prepare` but **before** `railpack_build_repair`, so deterministic fallbacks may show `build_status: unknown` in the Overview section even when the final response has `build_status: passed`. Prefer the top-level `build_status` field in UI.

---

## 6. Build context directory (critical)

This is the most common integration bug. The Docker **context path** for `docker buildx build` must match what sd-artifacts used when generating the plan.

### 6.1 Decision rules (replicate in smart-deploy)

Given cloned repo at `$REPO_DIR` and deploy unit with `root` (e.g. `apps/dashboard`):

```
IF unit.type == "existing_docker":
  BUILD_CONTEXT = join(REPO_DIR, unit.root)
  USE_RAILPACK = false

ELSE IF unit has package.json at unit.root
     AND repo root has workspace config (pnpm-workspace.yaml OR package.json workspaces)
     AND package.json at unit.root has a "name" field:
  BUILD_CONTEXT = REPO_DIR                    # monorepo root
  # plan commands use pnpm/yarn/npm workspace filters internally

ELSE:
  BUILD_CONTEXT = join(REPO_DIR, unit.root)   # standalone package or Go/Python app
  USE_RAILPACK = true
```

**Examples from real runs:**

| Repo layout | `package_path` | `unit.root` | `BUILD_CONTEXT` |
|-------------|----------------|-------------|-----------------|
| pnpm monorepo | `apps/web` | `apps/web` | **repo root** |
| Go app | `apps/backend` | `apps/backend` | **`apps/backend`** |
| Single Next app at root | `.` | `.` | **repo root** |

### 6.2 Applying `railpack_json` overrides

If `deploy_units[].artifacts.railpack_json` is non-null, write it to:

```
{BUILD_CONTEXT}/railpack.json
```

before building. This merges repair patches sd-artifacts discovered during verification. If null, no file needed (Railpack auto-detects).

---

## 7. Building with Railpack (production path)

sd-artifacts verifies builds with `railpack build` (CLI → BuildKit). smart-deploy should use the **BuildKit frontend** in production (Railpack recommendation).

### 7.1 Prerequisites on smart-deploy build workers

- Docker with BuildKit / `docker buildx`
- Network access to `ghcr.io` (frontend image)
- Optional: `BUILDKIT_HOST` if using remote BuildKit

### 7.2 Build steps per deploy unit

```bash
# 1. Clone repo at commit_sha (smart-deploy already does this)

# 2. Resolve BUILD_CONTEXT per §6

# 3. Write plan to a temp file
PLAN_FILE=$(mktemp)
echo '$RAILPACK_PLAN_JSON' > "$PLAN_FILE"

# 4. Optionally write railpack.json overrides into BUILD_CONTEXT

# 5. Pin frontend version to response.railpack_version
FRONTEND="ghcr.io/railwayapp/railpack-frontend"
if [ -n "$RAILPACK_VERSION" ]; then
  FRONTEND="${FRONTEND}:v${RAILPACK_VERSION}"
fi

# 6. Build
docker buildx build \
  --build-arg BUILDKIT_SYNTAX="${FRONTEND}" \
  -f "$PLAN_FILE" \
  -t "$IMAGE_TAG" \
  --load \
  "$BUILD_CONTEXT"
```

**Important:**

- `-f` points to the **plan JSON file**, not a Dockerfile
- Last argument is **context directory** (`BUILD_CONTEXT`, not always unit root)
- Pin `railpack-frontend` tag to `AnalyzeResponse.railpack_version` (strip any `v` prefix consistently)

Reference: [Railpack production guide](https://railpack.com/guides/running-railpack-in-production/)

### 7.3 Runtime / start command

After build, container entrypoint comes from:

```typescript
const startCmd = getStartCommand(unit.artifacts.railpack_plan);
```

Use for:

- Kubernetes `command`/`args` parsing (may need shell wrapper)
- Procfile / platform start command
- Health check port → `unit.port` (heuristic — confirm from briefing)

### 7.4 Static / Vite apps without start command

`static_build` units (Vite, etc.) often produce a build with **no start command**. Railpack warns: "No start command".

smart-deploy options:

1. **Static hosting path:** extract built assets from image filesystem and serve via CDN/nginx (check plan steps for output dir, often `dist/`)
2. **Railpack SPA serve:** set `RAILPACK_SPA_OUTPUT_DIR` env at build time if needed
3. **Do not assume** a long-running process — `deploy_shape: static_build` + missing `startCommand` = static site workflow

---

## 8. Multi-unit (`deploy_shape: "multi"`)

When the scoped `package_path` is a monorepo root with multiple workspace packages, classifier emits one `DeployUnit` per sub-package.

smart-deploy should:

1. Iterate `deploy_units[]`
2. Build/deploy each unit independently
3. Map each to a separate smart-deploy **service**
4. Use each unit's `name`, `root`, `port`, and `railpack_plan`
5. Respect `build_status: partial` — some services may be deployable while others failed

---

## 9. Cache model (shared Supabase)

Cache key: **`(repo_url, commit_sha, package_path)`** — no `service_name`.

| Column | Use in smart-deploy |
|--------|---------------------|
| `schema_version` | Stored on cache rows; parse `result` → prefer `deploy_units` for app logic |
| `build_status` | Quick filter without parsing JSON |
| `deploy_shape` | UI badges |
| `railpack_version` | Pin frontend |
| `workflow_version` | Track which sd-artifacts release produced the result |
| `result` | Full `AnalyzeResponse` JSON |

### 9.1 Cache lookup flow in smart-deploy

```
1. User picks repo + package_path + branch/commit
2. smart-deploy calls POST /analyze with commit_sha if known
   - Cache hit → instant response
   - Cache miss → full pipeline (~minutes)
3. Store response_id + full payload in smart-deploy DB
4. On deploy failure → POST /feedback with user notes
5. On bad analysis → POST /responses/status { passed: false } to bust cache
6. Force refresh → POST /analyze { refresh: true }
```

### 9.2 Legacy cache invalidation

Legacy file-bundle cache rows are **ignored** by current sd-artifacts when they do not match the analyze shape smart-deploy expects. smart-deploy should treat any stored legacy artifacts as obsolete and re-analyze.

---

## 10. Environment variables

### 10.1 From `railpack_plan.deploy.variables`

Display in smart-deploy env config UI. These are **defaults Railpack detected**, not secrets.

### 10.2 User secrets

Database URLs, API keys, etc. are **not** in the analyze response. smart-deploy injects them at deploy time via platform secrets / `--secret` flags.

Railpack secrets pattern:

```bash
DATABASE_URL=postgres://... docker buildx build \
  --build-arg BUILDKIT_SYNTAX="ghcr.io/railwayapp/railpack-frontend:v0.26.1" \
  -f plan.json \
  --secret id=DATABASE_URL,env=DATABASE_URL \
  "$BUILD_CONTEXT"
```

### 10.3 smart-deploy → sd-artifacts client config

```env
SD_ARTIFACTS_URL=https://...
SD_ARTIFACTS_BEARER_TOKEN=...   # same as SD_API_BEARER_TOKEN on server
```

---

## 11. Error handling patterns

### 11.1 Structured scanner errors

```typescript
if (response.status === 400 && detail?.code === "scope_required") {
  showPackagePathPicker(detail.suggested_package_paths);
}
```

### 11.2 Build failure with repair trail

Show `repair_history` in UI:

- `diagnosis` — what the AI thought went wrong
- `build_log_excerpt` — tail of build output
- `patch` — what was tried (`railpack_json`, `env_overrides`)

Offer "Suggest fix" → calls `/feedback` with user text.

### 11.3 Missing plan

If `deploy_units[i].artifacts.railpack_plan` is null:

- `existing_docker` → use Dockerfile path
- otherwise → analysis incomplete; call `/analyze` with `refresh: true`

---

## 12. smart-deploy migration checklist

Use this as the agent task list.

### Phase A — Remove legacy file-bundle assumptions

- [ ] Delete code paths that read/write `dockerfile`, `compose`, `nginx` from analyze response (top-level **`commands`** deploy path removed in smart-deploy; use `railpack_plan.steps` / CodeBuild instead)
- [ ] Remove `service_name` from cache keys, DB models, and API calls
- [ ] Normalize and gate on `deploy_units` / `build_status` (not file-bundle artifacts)
- [ ] Update TypeScript types / OpenAPI client to match §4

### Phase B — Analyze integration

- [ ] Call `POST /analyze` or `/analyze/stream` with `package_path`
- [ ] Handle `scope_required` → package path picker UI
- [ ] Store `response_id`, `commit_sha`, `package_path`, full payload
- [ ] Display `deploy_briefing` markdown in review step
- [ ] Show `build_status`, `railpack_version`, `workflow_version`

### Phase C — Build & deploy

- [ ] Implement build context resolver (§6)
- [ ] Write `railpack_plan` to temp file; optional `railpack.json` to context
- [ ] `docker buildx build` with pinned `railpack-frontend` tag (§7)
- [ ] Branch on `deploy_shape`:
  - [ ] `existing_docker` → standard Dockerfile build at `unit.root`
  - [ ] `static_build` without start → static asset pipeline
  - [ ] `multi` → loop units
- [ ] Configure service port from `unit.port` + briefing
- [ ] Inject user secrets separately from plan variables

### Phase D — Feedback & cache

- [ ] Wire `/feedback` or `/feedback/stream` to "Fix deploy" UI
- [ ] Wire `/responses/status` thumbs-down → cache bust
- [ ] Support `refresh: true` "Re-analyze" button
- [ ] Optional: `DELETE /cache` for admin tools

### Phase E — Validation

- [ ] Test: pnpm monorepo (`package_path=apps/web`) — context = repo root
- [ ] Test: Go subdir (`package_path=apps/backend`) — context = subdir
- [ ] Test: Vite/static (`static_build`) — no start command path
- [ ] Test: cache hit via `commit_sha`
- [ ] Test: feedback loop after deliberate build failure
- [ ] Test: `existing_docker` repo with Dockerfile

---

## 13. Example responses

### 13.1 Go server (single unit)

```json
{
  "schema_version": 2,
  "response_id": "550e8400-e29b-41d4-a716-446655440000",
  "commit_sha": "abc123",
  "package_path": "apps/backend",
  "deploy_shape": "server",
  "railpack_version": "0.26.1",
  "workflow_version": "sd-artifacts@dev",
  "build_status": "passed",
  "deploy_units": [{
    "name": "backend",
    "root": "apps/backend",
    "type": "server",
    "provider": "go",
    "framework": null,
    "port": 8080,
    "artifacts": {
      "railpack_plan": {
        "steps": [
          { "name": "install", "commands": [{ "cmd": "go mod download" }] },
          { "name": "build", "commands": [{ "cmd": "go build -o out ./cmd/server" }] }
        ],
        "deploy": { "startCommand": "./out" }
      },
      "railpack_json": null
    }
  }],
  "deploy_briefing": "# Deploy briefing\n\n## Overview\n\n...",
  "build_verification": {
    "backend": "railpack",
    "status": "passed",
    "message": "Railpack build verification complete.",
    "attempts": 1,
    "duration_seconds": 45.2,
    "log_excerpt": "..."
  },
  "repair_history": [],
  "errors": []
}
```

**smart-deploy build context:** `$REPO_DIR/apps/backend`

### 13.2 Vite dashboard (static_build, build-only)

```json
{
  "deploy_shape": "static_build",
  "build_status": "passed",
  "deploy_units": [{
    "name": "dashboard",
    "root": "apps/dashboard",
    "type": "static_build",
    "provider": "node",
    "framework": "vite",
    "port": 3000,
    "artifacts": {
      "railpack_plan": {
        "steps": [
          { "name": "install", "commands": [{ "cmd": "pnpm install --frozen-lockfile" }] },
          { "name": "build", "commands": [{ "cmd": "pnpm --filter dashboard run build" }] }
        ],
        "deploy": {}
      },
      "railpack_json": null
    }
  }]
}
```

**smart-deploy build context:** `$REPO_DIR` (monorepo root — dashboard has `name` in package.json)

**Runtime:** no `startCommand` — use static hosting workflow.

---

## 14. Optional: direct Supabase / MCP reads

If smart-deploy shares the Supabase project, it can read cache directly:

**Table `analysis_cache`:** keyed by `(repo_url, commit_sha, package_path)`, column `result` = full response.

sd-artifacts also exposes an MCP server (`python mcp_server.py`) with resources:

- `analysis-response://{response_id}`
- `analysis-cache://{base64url(repo_url)}/{commit_sha}[/{base64url(package_path)}]`

Prefer HTTP API unless smart-deploy already integrates via MCP.

---

## 15. Source of truth in sd-artifacts repo

| Topic | File |
|-------|------|
| Response models | `models/schemas.py` |
| API routes | `app.py` |
| Classifier / deploy shapes | `graph/nodes/classifier.py` |
| Build context rules | `tools/workspace_context.py` |
| Railpack CLI wrappers | `tools/railpack_tools.py` |
| Plan → briefing extraction | `graph/nodes/deploy_briefing.py` |
| Feedback workflow | `graph/feedback.py`, `docs/feedback-workflow.md` |
| Supabase schema | `supabase_schema.sql`, `migrations/v2_schema.sql` |

---

## 16. Version alignment

| Component | Alignment rule |
|-----------|----------------|
| sd-artifacts `railpack_version` | Pin `ghcr.io/railwayapp/railpack-frontend:v{version}` |
| sd-artifacts `workflow_version` | Informational — track in telemetry |
| `schema_version` | Informational if present — align types with §4 |
| smart-deploy deploy code | Should tolerate new `deploy_shape` / unit `type` values gracefully |

When sd-artifacts upgrades Railpack CLI, re-analyze (`refresh: true`) before deploy so plans match the frontend version.

---

## 17. SPA / `static_build` & workload routing (smart-deploy)

sd-artifacts still produces a **container image** for Vite and other frontends via Railpack + BuildKit. What changes is **runtime intent**: Caddy SPA mode, `vite preview`, no start command (monorepo build-only), etc. smart-deploy must branch on `deploy_shape`, `unit.type` / `framework`, and `railpack_plan.deploy.startCommand` — not on a different `/analyze` API.

### Decision tree (product)

```
if deploy_shape === "existing_docker":
  → docker build from repo Dockerfile (no Railpack)

else if deploy_shape === "static_build":
  startCmd = plan.deploy?.startCommand

  if startCmd looks like Caddy / common static server:
    → deploy as container (static runtime)

  else if no startCmd:
    → Option A: Railpack SPA image — set RAILPACK_SPA_OUTPUT_DIR (e.g. apps/dashboard/dist for monorepos)
    → Option B: build-only → extract dist → object storage + CDN (different smart-deploy job graph)

  else if startCmd is vite preview / dev-ish:
    → warn; prefer removing start for SPA mode or static extract

else if deploy_shape === "server" (Node, Go, Python, Next SSR, …):
  → long-lived API/container using startCommand + secrets + app port

else if deploy_shape === "multi":
  → one deploy unit per service; possibly mixed static + API
```

### Framework notes

| Framework | Typical shape | smart-deploy focus |
|-----------|---------------|--------------------|
| **Vite** | `static_build` | SPA dir, avoid `vite preview` in prod |
| **Next.js** | `server` (SSR) or `static_build` (export) | Confirm which; SSR needs Node runtime + env |
| **Node / Express** | `server` | Process + port + health |
| **Go / Python** | `server` | Same as API container |

### Codebase

- **`classifyScanWorkload`** (`src/lib/sdArtifactsWorkload.ts`) — central classification for UI and future deploy switches.
- **Overview** — `WorkloadInsightCard` surfaces shape, build status, per-unit product, and `RAILPACK_SPA_OUTPUT_DIR` hints when there is no start command.

Railpack production build flags remain as in §7 (`docker buildx build` with plan file + pinned frontend).
