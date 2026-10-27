# Runtime dependency security update

This increment updates the dependency set used by the app and WebSocket worker.
It does not enable the private gateway, migrate the production database, change
provider connections, or establish that the entire small-software feature is ready.

| Direct dependency | Previous floor | Updated floor |
|-------------------|----------------|---------------|
| Next.js / eslint-config-next | 16.2.6 | 16.4.3 |
| Better Auth | 1.6.23 | 1.7.12 |
| Undici | 7.24.5 | 7.30.1 |
| Zod | 3.25.73 | 4.6.7 |

The lockfile also updates vulnerable transitive dependencies within their
supported ranges, using npm without a forced audit fix. A fresh `npm ci` and
both full and production-only npm audits report zero known vulnerabilities for
the resulting dependency set. This is a point-in-time audit result, not proof
that every possible security issue has been eliminated.

Next.js's maintainer documents affected/patched image-optimization releases in
[GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
The selected Next.js release remains on major version 16. Undici stays on its
Node 20-compatible major version 7. Review future updates against the app's CI
and worker Node versions rather than automatically selecting a new major.

## Validation and typechecking compatibility

The Zod major upgrade follows its [migration guide](https://zod.dev/v4/changelog).
Browser and machine request bodies use `z.strictObject`; unknown authority fields
remain rejected. The browser binding uses `z.uuid`. Invitation email input is
trimmed before `z.email` validation, preserving the prior normalization order.
An API regression test checks whitespace normalization and extra-field rejection.

The newer Next.js build exposed invalid test fixtures under full TypeScript
checking. Fixtures now supply required workspace props and deployment fields,
use complete typed repository records and real agent event payloads, and resolve
the deferred deployment request without an unreachable nullable callback. No
tests or assertions were removed to make the build pass. Railpack's shared type
now models the non-shell commands and step metadata already handled by the
runtime and its existing tests.

`npm run typecheck` checks the whole project, including tests. CI runs it and
`npm run ws:build` after the application build, preserving coverage beyond the
framework's own typechecking choices. Next.js also generates a managed AGENTS.md
block pointing at its bundled version-matched guides when development starts;
the existing repository instructions are preserved.

## Authentication compatibility and rollout

Keep Better Auth and the existing PostgreSQL/Supabase platform dependencies.
The real-library database suite uses the installed Better Auth schema and signed
cookies to verify sign-in, app handoff, current platform-session linkage, grant
revocation, expiry, global app logout, and failure rollback. Better Auth 1.7.12
still catches raw sign-out deletion errors; the transactional logout guard
remains necessary and is retained.

These tests use a disposable local PostgreSQL database. They do not apply any
production auth migration. Compare the deployed schema and default auth profile
before promotion; do not add custom auth tables, hooks, or secondary session
caches without adapting and testing the logout contract. A dependency upgrade
does not authorize enabling unfinished private-runtime behavior.

The broader repository-health and complete feature acceptance gates remain
separate from this dependency patch. Preserve the rollout stack's explicit merge
order and keep billing PR #85 separate.

## Verified candidate

- Full unit suite: 123 files / 457 tests passed.
- PostgreSQL 16 suite: seven files / 69 tests passed after the schema API changes.
- Full project typecheck, WebSocket compilation, and production build passed.
- Six Chromium public-page regression tests passed on the upgraded app.
- Full and production-only dependency audits report zero vulnerabilities.
- Pinned React Doctor 0.9.18, unfiltered full scope: 49/100 with 49 diagnostics
  before the patch; 72/100 with 47 diagnostics afterward. The two Socket security
  findings are gone. The existing socket cleanup finding and 46 warnings remain
  for the repository-health follow-up. No new diagnostic remains from the Zod
  migration. The exact changed-file scan covered all 15 TypeScript files and
  reported 100/100 with zero diagnostics.

Lint exits successfully with the newer Next.js rule reporting one existing
internal-location navigation pattern in SessionFailureLogoutGuard. The production
build retains dynamic repository-filesystem tracing warnings; both findings are
recorded for follow-up rather than hidden. The database and browser test servers
were stopped afterward. No production migration, cloud provisioning, runtime
enablement, provider connection change, merge, or production deployment occurred.

The candidate was subsequently rebased onto the released analytics credential
hotfix (#101, production `a8af9f3`). Its dependency/validation changes remain a
separate review boundary. The refreshed pinned unfiltered full scan reports
73/100, one error and 46 warnings; the historical 72/100 result above describes
the original candidate. The production exception applied only to #101. This
upgrade still requires the wider health and feature gates before promotion.
