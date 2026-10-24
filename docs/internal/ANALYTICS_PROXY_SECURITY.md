# Analytics proxy credential isolation

The public analytics proxy previously copied browser request headers directly
to the external analytics upstream. That included platform session cookies,
authorization headers, and unrelated private headers. It also relayed upstream
cookie and site-data control headers back under SmartDeploy's origin.

This patch forwards only the analytics payload's content type/encoding, accept
headers, language, and user agent. It omits fetch credentials and strips
connection-nominated headers. Response cookie, authentication prompt, site-data
control, and hop-by-hop headers cannot alter the platform's session. Query
strings, request bodies, error statuses, retry metadata, and bodyless responses
retain their existing behavior. The provider connection and project token are
unchanged. Incoming referrers and forwarded client-IP headers are no longer
passed to the provider.

PostHog's [proxy guidance](https://posthog.com/docs/advanced/proxy) explains that
ingestion uses the project token in the request body and does not need browser
cookies. Its [Next.js proxy guide](https://posthog.com/docs/advanced/proxy/nextjs-middleware)
also removes cookie and authorization headers before forwarding.

## Evidence and boundaries

The two credential-boundary regression tests fail against the original handler:
private request headers reach its upstream fetch, and an upstream Set-Cookie
header reaches the browser response. The patched handler is exercised with
dummy credentials only. A real browser/Next.js/local-upstream scenario verifies
the browser's HttpOnly test cookie and bearer header stay local, upstream cookie
and site-data headers are stripped, and the request payload and 429/retry
response survive the proxy.

The latest GitHub-recorded Production deployment identifies revision
`d02d6fc52024b658268ff9b22b79bc5df4d361f1`; its proxy has the forwarding behavior.
A fresh unauthenticated browser on the public production page requests the
first-party `/ph/array/<public-project-token>/config.js` path. No signed-in
browser or real account credential was used for that probe. Provider logs and
historical credential retention have not been inspected; this establishes an
active routing risk, not proof of third-party account access.

Before production cutover, determine whether existing platform sign-ins must
be expired to invalidate potentially forwarded cookies. Session invalidation
should remove the affected server-side session records after the fixed handler
is serving traffic, without deleting users or provider accounts. Do not blindly
rotate Better Auth's main secret: the current configuration also uses it for
OAuth token encryption. No session invalidation is executed by this patch.

## Deployment safety

The user's approved pilot is on demand with at most $10 additional AWS spend per
month. A web-only main-branch change must not implicitly start the stopped AWS
worker or apply its infrastructure. Automatic worker deployment is therefore
opt-in via repository variable `WORKER_AUTODEPLOY_ENABLED=true`; an explicit
workflow dispatch retains the existing manual deployment path. The variable is
absent in the inspected repository, so automatic worker deployment stays off.
No provider connection, variable, infrastructure, instance state, or database
is modified by preparing this change.

This independent hotfix targets the current production branch. It does not
include workspace/gateway migrations or enable unfinished private applications.
The earlier production authorization was conditioned on the entire feature being
verified; shipping this narrower security fix early requires a separate decision.

## Candidate verification

This branch starts directly from `origin/main` at `d02d6fc`, with the unchanged
production dependency lockfile. Baseline regression run: four failures and three
passes, including both credential-boundary failures. Patched run: all seven
tests pass. The real Chromium/Next.js/local-upstream scenario passes against
this dependency set; lint and production builds pass before and after the
patch. The two workflow YAML files parse successfully. The local browser and
fake upstream are stopped after the run.

React Doctor 0.9.18 full unfiltered scope remains 49/100 with three errors and
46 warnings, identical to the production baseline. The exact four-file scan is
91/100 with one existing proxy status-consumption warning. This handler mirrors
the upstream status rather than treating it as success: unit and network tests
verify an actual upstream 429 remains a 429 with its body and Retry-After value.
The finding is recorded as a high-confidence detector mismatch, without any
suppression or threshold change. Neither raw score meets the repository's
95/100 requirement; early release requires an explicit, limited exception.
Existing dependency findings remain separate from this credential fix; the
dependency upgrade candidate is [PR #98](https://github.com/anirudh-makuluri/smart-deploy/pull/98).

A read-only check of the configured production database found the expected
session columns and zero active logins. No database record was changed. At an
approved cutover, verify the deployed commit and the updated `/ph/...` OPTIONS
headers before checking for pre-fix active sessions again. If that count is
zero, do not issue a deletion. Any authorized invalidation must use a verified
production connection, a parameterized cutover timestamp, a transaction with
short lock/statement timeouts, and only the session table:

```sql
select count(*) from public.session
where "createdAt" < $1::timestamptz and "expiresAt" > clock_timestamp();
-- Only after explicit authorization and fixed-handler verification:
delete from public.session where "createdAt" < $1::timestamptz;
```

User records and OAuth provider accounts must remain untouched. The feature
rollout's production gate remains in effect for every other PR and AWS startup.
