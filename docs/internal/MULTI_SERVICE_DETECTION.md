# Multi-service detection

This document describes how Smart Deploy decides what counts as a **service**, how many services exist, and how paths and stacks are inferred. The behavior lives primarily in `src/lib/multiServiceDetector.ts`.

There are **two** entry points:

| Entry point | Function | Used for |
|---------------|----------|----------|
| **Repo service catalog** | `discoverServiceCatalog(repoRoot, repoSlug)` | `detectServices` GraphQL mutation: the list of services on the repo page, persisted per user/repo. |
| **Deploy-time detection** | `detectMultiService(appDir, options?)` | Cloning the repo (or a subdirectory) and resolving **how** to build/run: compose, `projects/*` stacks, monorepo packages, nested compose + Dockerfiles + root siblings merged with pattern heuristics, or a single root app. Also used inside `addRepoServiceRoot` on the chosen subdirectory, and by `buildPrefilledScanResults` (see `src/lib/infrastructurePrefill.ts`) when inferring scan artifacts from disk. |

The catalog and deploy detectors **do not** use identical rules. The sections below spell out each pipeline in evaluation order.

---

## 1. Repo service catalog — `discoverServiceCatalog`

**Goal:** Produce a **stable list of rows** for the repo UI (one card per logical deployable unit where possible), merged from several sources, then **deduplicated by service name**.

### 1.1 Step A — Docker Compose (directory-level)

- The tree is walked from `repoRoot` up to **depth 6** (inclusive).
- Skipped directory names: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`, `__pycache__` (and dot-prefixed dirs are ignored).
- Recognized filenames (per directory, one “winning” file if several exist): `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml` (preference order favors `docker-compose.yml` when multiple exist in the same folder).
- For each directory that has a compose file, the file is parsed. **Database-only** compose services are dropped (see [§4.2](#42-compose-database-filtering)).
- **Catalog rule:** the whole compose directory becomes **one** catalog row (services inside compose are **collapsed** for the UI). Summary fields (language, port, framework) are inferred from that directory and the first “interesting” compose service (port, dockerfile, or first remaining).

### 1.2 Step B — Monorepo packages (`detectMonorepoServices`)

Runs only if **monorepo tooling** is present at `repoRoot`:

- `pnpm-workspace.yaml`, or  
- `package.json` with `workspaces`, or  
- `turbo.json`, `nx.json`, or `lerna.json`.

Then **only** immediate children of these roots are considered:

- `apps/*`, `services/*`, `packages/*`, `modules/*`, `projects/*`

Per child directory:

- Skip **mobile-only** dirs (name list + Expo/React Native/Flutter heuristics in `package.json`, `pubspec.yaml`, or `android` + `ios`).
- Require `detectLanguage` to succeed (see [§3](#3-language-and-framework-detection)).
- Under `packages/*` only: skip packages whose `package.json` has **no** `scripts.start`, `scripts.serve`, or `scripts.dev` (treated as libraries).

**Dedup:** Any monorepo row whose normalized relative path **exactly equals** a compose catalog row’s path is omitted (compose wins for that path).

### 1.3 Step C — Dockerfile directories

- Same **depth 6** walk and **same skip dirs** as compose catalog.
- Any directory containing `Dockerfile` or `Dockerfile.*` becomes a candidate; **`Dockerfile` is preferred** over `Dockerfile.<suffix>` when both exist.
- **Dedup:** If the directory’s normalized relative path is already claimed by compose or monorepo rows, it is skipped.
- Language: `detectLanguage` on that directory, or **`unknown`** if none. Port: Next.js → `3000`, else `getDefaultPort(language)` (unknown → **8080**).

### 1.4 Step D — Root sibling apps

- Only **one level** under `repoRoot` (immediate subdirectories).
- Same skip dir set as above; skip mobile-only dirs.
- Include the directory only if `detectLanguage` succeeds **and** its path is not already claimed (compose, monorepo, or Dockerfile catalog).

This covers layouts like `api/` + `ui/` with **no** root `package.json` and no workspace markers.

### 1.5 Step E — Repository root app (optional extra row)

If, after steps A–D, **no** catalog row uses relative path `.` **and** `detectSingleRootService(repoRoot, repoSlug)` returns a service, that **root app** is appended.

This allows e.g. Next.js at `.` **plus** a sibling folder service without losing the root app.

`detectSingleRootService` **does not** run when monorepo tooling is present at root, when the root looks **mobile-only** (Expo/RN/Flutter at root), or when `detectLanguage` fails at root.

### 1.6 Step F — Fallback placeholder

If the combined list from A–E is still **empty**:

- Try `detectSingleRootService` again (same rules as E).
- If still nothing: one placeholder at `.` named from the **repo slug** (sanitized), `language: "unknown"`.

### 1.7 Catalog merge and flags

- All rows from A–E (plus optional root from E) are concatenated in order: **compose → monorepo → dockerfiles → siblings → (optional root app)**.
- **Name collisions** are resolved by `dedupeCombinedServiceNames` (suffix `-2`, `-3`, …).
- `hasDockerCompose` is true if **any** row came from step A.
- `isMonorepo` is true only if monorepo tooling was detected **and** at least one monorepo service survived dedup against compose.

---

## 2. Deploy-time detection — `detectMultiService`

**Goal:** Pick **one** strategy for the given `appDir` (usually the **clone root**). First match wins. Used when resolving how to deploy/analyze from disk **without** the catalog’s Dockerfile/sibling extensions (unless that logic is added here later).

### 2.1 Order of evaluation

1. **Root Docker Compose** — `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` / `compose.yaml` in `appDir`.  
   - If every remaining (non-DB) service name matches **infra-only** heuristics (Kafka, Prometheus, Grafana, Postgres, Redis, etc.), the root compose is **ignored** for the “main” result and the code tries **`projects/*/compose`** next (see 2).  
   - Otherwise the **full compose config** is returned: one `ServiceDefinition` per non-DB compose service (not collapsed to one row).

2. **`projects/` compose only** (when root compose was infra-only, or when there is **no** root compose): each `projects/<name>/` directory is checked for compose; services are merged with names derived from folder and compose service names.

3. **Monorepo** — Same `detectMonorepoServices` as the catalog (tooling + `apps|services|packages|modules|projects`).

4. **Merged filesystem + patterns** — `buildNonMonorepoDeployServiceList` (only when monorepo detection returned nothing):  
   - **Nested compose:** every `docker-compose.*` / `compose.*` under the repo (same walk as the catalog, depth 6), **except** the repository root (root compose is handled in step 1). Each stack is **expanded** to one deploy service per non-DB compose service (names prefixed with the stack folder when multiple services share a file).  
   - **Dockerfiles:** same depth-6 walk and skip dirs as the catalog; one candidate per directory containing `Dockerfile` / `Dockerfile.*`; skips directories already used as a **nested compose stack root**.  
   - **Root siblings:** immediate subdirectories with `detectLanguage`, same skips as the catalog; skips paths already claimed as a compose stack root.  
   - **Pattern merge:** services from `detectMultiServicePatterns` are added only when their path key does not duplicate an existing row (so fixed names like `api`/`ui` still work, and arbitrary folder names from the steps above are not dropped).  
   - **Root app inject:** if `.` is not yet represented and `detectSingleRootService` succeeds, the root app is appended (same idea as catalog §1.5).

5. **Single root app** — If the merged list is still empty: `detectSingleRootService` (same rules as catalog §1.5).

6. **Nothing** — Empty `services` array.

### 2.2 Remaining differences vs the catalog

- **Compose at repository root:** deploy-time still returns **one service per compose service** (expanded). The catalog still **collapses** root and nested compose **directories** to one UI row per directory.  
- **Pattern-only Dockerfile depth:** inside `detectMultiServicePatterns`, the **depth-3** multi-Dockerfile branch can still add extra services when merged dedupe allows; the primary Dockerfile scan uses **depth 6** (same as the catalog walk).

---

## 3. Language and framework detection

### 3.1 `detectLanguage(dir)`

A directory is classified by **markers on disk** (first match):

| Marker | Language |
|--------|----------|
| `package.json` | `node` |
| `requirements.txt` | `python` |
| `go.mod` | `go` |
| `pom.xml` or `build.gradle` | `java` |
| `Cargo.toml` | `rust` |
| Any `*.csproj` or `*.sln` in the directory listing | `dotnet` |
| `composer.json` | `php` |

If none match, language is **undefined** (catalog Dockerfile step may still set `unknown`).

### 3.2 `detectFramework(dir)`

Primarily from `package.json` dependencies: `next` → `nextjs`, `express`, `fastify`, `@nestjs/core`, `nuxt`, `react`, `vue`, `@angular/core`, `svelte`. From `requirements.txt` text: `django`, `flask`, `fastapi`.

### 3.3 Default ports (`getDefaultPort`)

| Language | Port |
|----------|------|
| node | 3000 |
| python | 8000 |
| go / java / rust | 8080 |
| dotnet | 5000 |
| php | 8000 |
| other / unknown | 8080 |

Catalog rows with `framework === "nextjs"` use port **3000** regardless of language default.

---

## 4. Compose parsing details

### 4.1 Service shape from compose

For each compose service (after DB filter): `workdir` / `build_context` follow compose `build.context`; `dockerfile` from compose or inferred (`Dockerfile.<service>` at compose dir, or `<context>/Dockerfile`). Port from first `ports` string mapping if parseable.

### 4.2 Compose database filtering

A compose service is treated as **database-only** and skipped if the **service name** or **image** string matches keywords such as `db`, `database`, `postgres`, `mysql`, `mongodb`, `redis`, `sqlite`, etc.

---

## 5. Infra prefill and `packagePath` (analyze / deploy artifacts)

`buildPrefilledScanResults(repoRoot, packagePath?)` in `src/lib/infrastructurePrefill.ts`:

- Calls `detectMultiService(repoRoot)` on the **full clone**, then **filters** detected services to those under `packagePath` when it is set and not `.`.
- Dockerfiles and nginx discovery are also **scoped** to paths under `packagePath` when possible.
- **Root** `docker-compose.*` is still **read from repo root** when present; it may appear in `scanResults.docker_compose` even for a scoped service. Build pipelines use compose for the image build only when both compose content exists **and** the filtered **`services` list has more than one** entry (see `generateBuildspec` in `src/lib/aws/codebuildHelpers.ts`).

So “multi-service” in the **UI catalog** and “multi-service” in **CodeBuild** can diverge depending on `packagePath` and the length of the `services` array in scan results.

---

## 6. Related mutations (not full detection passes)

- **`detectServices`:** runs `discoverServiceCatalog` and persists the result (see `src/lib/graphql/resolvers/mutation.ts`).
- **`addRepoServiceRoot`:** validates a repo-relative directory, then runs **`detectMultiService(absPath)`** on **that directory only** to fill language/framework for the new row; it does **not** re-run `discoverServiceCatalog` for the whole repo.

---

## 7. Quick reference — what wins?

| Scenario | Catalog (`discoverServiceCatalog`) | Deploy (`detectMultiService` on clone root) |
|----------|-------------------------------------|-----------------------------------------------|
| Root compose with app + db | One row at `.` (collapsed) | Multiple services (db stripped) |
| `api/` + `ui/`, no root package | Two sibling rows | Same sibling scan + pattern merge (no root compose required) |
| `gateway/` + `bff/`, no root package | Two sibling rows (if both have `detectLanguage`) | Same |
| Monorepo `apps/web` | Row per package (if tooling present) | Same via `detectMonorepoServices` |
| Multiple compose dirs | One row per dir | **Expanded:** one deploy service per non-DB compose service per stack (except root, handled first) |
| `stack/compose.yml` only, no root compose | One catalog row for `stack/` | One row per compose service under `stack/` |

When extending behavior, keep **`buildNonMonorepoDeployServiceList`** and **`discoverServiceCatalog`** in sync for filesystem rules (Dockerfile depth, skip dirs, sibling scan).
