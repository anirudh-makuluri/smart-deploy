# Small-software production readiness

Audit date: October 23, 2026 (America/Phoenix).

Decision: **not ready to promote the entire feature to production**.

The user authorized starting the existing AWS WebSocket server and promoting the
rollout PRs after testing establishes confidence in the entire feature. That
condition is not met. This is a technical readiness result, not a request for
additional deployment permission. No production instance was started, PR merged,
production migration applied, feature enabled, or production release dispatched
during this audit. Billing #85 remains separate.

## Candidate and evidence

Audited implementation candidate: PR #97, commit
`6383349b46cc58d3b45995e16a42d3007e670def`, which contains the implementation stack
#91 -> #92 -> #93 -> #94 -> #95 -> #96 -> #97. It is zero commits behind and eight
commits ahead of the fetched origin/main. All implementation PRs remain open;
#92-#97 remain drafts. All their reported GitHub checks passed at the recorded
heads. No feature source changed during this audit.

| Check | Result | Boundary |
|-------|--------|----------|
| Existing current-head unit/database CI and prior local validation | 456 unit tests / 69 PostgreSQL tests passed | Rechecked live CI and the unchanged candidate hash; these full suites were not rerun unnecessarily. Covers the control-plane backend, not a complete deployed app. |
| WebSocket production compilation | `npm run ws:build` passed | TypeScript compilation and alias rewriting; not a container rollout or running-server proof. |
| Additional WebSocket unit checks | Seven files / 26 tests passed | Auth tokens, socket events, logging/types, client connection/session behavior; mocked sockets are not hosted socket proof. |
| Existing Chromium browser regression suite | Six tests passed with one worker | Public landing/demo, docs/changelog desktop/mobile layout, shell, and a mocked API error. Gateway/workspace flags disabled, dummy local auth values, no production database. No private-app creator/member/outsider browser flow exists in this suite. |
| Repository-wide React Doctor | 559 files, 49/100, 49 diagnostics; exit 1 | Three reported errors and 46 warnings. Below AGENTS.md's 95/100 requirement; per-PR changed-file scores of 100 do not establish whole-repository compliance. |
| Production dependency audit | 38 reported dependency entries: 2 critical, 22 high, 14 moderate | `npm audit --omit=dev --json`; requires security remediation/reachability review, not an assertion that every advisory is exploitable here. |
| AWS identity/target discovery | CLI account matches repository deployment configuration; configured production worker found in us-west-2, stopped | Read-only STS/EC2 and repository variable inspection. No credentials or provider connections changed. |
| Existing worker HTTPS health probe | Timed out after 12 seconds without an HTTP response | Does not establish TLS, application, or socket health. The worker was left stopped. |

The browser run invoked the Playwright Node CLI directly with
`--workers=1 --reporter=line`. Its local test server stopped afterward. Heavy
checks ran serially. Browser checks used dummy platform auth and empty database
settings and did not exercise production deployment actions.

Reproduction commands on the implementation candidate (Doctor 0.9.18):

```text
npm run ws:build
node node_modules/vitest/vitest.mjs run tests/unit/lib/wsAuth.test.ts tests/unit/lib/workerSocketEvents.test.ts tests/unit/lib/websocketLogger.test.ts tests/unit/lib/websocket-types.test.ts tests/unit/lib/useWorkerWebSocket.test.ts tests/unit/lib/useWorkerWebSocket.session.test.tsx tests/unit/websocket-types.test.ts --maxWorkers=2 --reporter=dot
node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line
npx react-doctor@latest --verbose --no-parallel
npm audit --omit=dev --json
```

The browser command used local dummy Better Auth values, an empty DATABASE_URL
and Supabase variables, WORKSPACE_APPS_ENABLED=false,
PRIVATE_APP_GATEWAY_ENABLED=false, and WAITING_LIST_ENABLED=false. Do not run it
with production database settings or mistake disabled-feature smoke for a private
app integration test. No source, dependency, or lockfile changed in this audit.

## Actual missing acceptance gates

1. **Complete private browser login.** The platform issuer exists, but the
   explicit confirmation screen and gateway-owned transaction/verifier/state,
   callback validation, cookie creation, expiry, replay, and cross-app browser
   checks are not implemented.
2. **Enforced private runtime.** There is no gateway HTTP/asset/WebSocket proxy,
   trusted upstream routing lifecycle, cookie/header isolation, or bounded
   WebSocket revocation loop. The current ECS path still calls
   `ensureSharedAlb`, `allowAlbToReachService`, and `ensureHostRule` directly in
   `src/lib/aws/ecsRailpackDeploy.ts`. Operator binding records and permission
   APIs do not block that origin path. Starting the platform WebSocket control
   plane does not supply this missing application gateway.
3. **AWS origin isolation and operating configuration.** Private routing/security
   groups, isolated application domain, explicit production lifetimes, ingress
   limits, and reviewed resource/cost choices remain required. No private origin
   has been provisioned or verified by these PRs.
4. **Remaining product scope.** Isolated persistent application data/files and
   secrets, preview/publish/share/invitation UI, app-scoped agent tooling and
   enforceable usage controls are unfinished.
5. **Integrated proof.** Creator, invited colleague, and outsider flows; data
   surviving a release; direct-origin denial; and HTTP/WebSocket revocation have
   not been exercised end to end. Existing browser tests do not cover them.
6. **Repository health and dependency security.** Resolve or evidence-review the
   full Doctor findings and upgrade/revalidate affected dependencies before
   claiming the required health/readiness. Do not suppress diagnostics or weaken
   the threshold to manufacture a passing release.

## Diagnostic triage

The reported `react-doctor/effect-needs-cleanup` at
`src/custom-hooks/useWorkerWebSocket.ts:389` appears to be a high-confidence false
positive on source inspection: after allocating the socket, the effect returns
cleanup that calls `socket.removeAllListeners()`,
`socket.io.removeAllListeners()`, and `socket.disconnect()`, then clears its
references. Early returns precede allocation. The file's Git blob is identical
to origin/main. No missing cleanup was asserted, code changed, diagnostic
suppressed, or score overridden based on this finding. The 26 additional socket
tests pass; they are not proof of every lifecycle race.

Doctor also flags Socket vulnerability-axis scores for Better Auth 1.6.23 and
Undici 7.24.5. The npm audit reports critical entries for Next.js and protobufjs;
it does not report a direct Better Auth entry in this run. Reconcile the sources
and the exact advisories rather than treating a package-health score as proof of
a particular exploitable CVE. Dependency versions were not changed by this
implementation stack (package.json only adds a database-test script).

Installed Next.js is 16.2.6. The maintainer's
[image optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
includes that release in its affected range and documents prerequisites and
patched versions. Review the complete current audit before selecting upgrades;
fixing one advisory does not resolve all reported entries.
The [protobufjs maintainer advisory](https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-xq3m-2v4x-88gg)
requires attacker-controlled schema/descriptor loading for that specific issue.
The reviewed [Undici SOCKS5 advisory](https://github.com/nodejs/undici/security/advisories/GHSA-vmh5-mc38-953g)
requires a SOCKS5 proxy with restricted TLS options. The repository directly
imports `Agent` in `deploymentHealthProbe.ts`; this audit has not established
exposure to every reported Undici path. These distinctions do not remove the
need to review and patch the current dependency set.

## Release sequencing when the condition is satisfied

Retain the user's conditional production authorization. Complete the missing
implementation and local/integration/browser proof first, preserving focused PR
boundaries and the separate billing work. Review and validate production migration
ordering/rollback, chosen runtime/domain/cost settings, and the final combined
candidate before enabling private publication.

Inspect `.github/workflows/deploy-ws-worker.yml` before merging: source pushes to
main trigger `scripts/update.sh`, which can update the EC2 worker and deployment
queue Lambda/ECS definitions. Merging this stack is a production action, not a
read-only review step. Do not merge the stack simply because its individual CI
checks are green while the entire-feature acceptance gates remain unmet.

After those gates pass, use the verified existing AWS target for startup/release,
then verify EC2/system/service health, HTTPS and an authenticated socket, final
deployed revisions/configuration, and the complete multi-user app outcome. Report
live proof separately from compilation, CI, or public-page browser checks.
