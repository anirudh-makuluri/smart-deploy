# Published and preview access

The user selected published-only access for colleagues with app-use grants.
Unpublished previews are reserved for workspace owners/admins. Current verified
identity, platform approval and app-specific permission checks continue to apply.

| Identity | Published binding | Preview binding |
| --- | --- | --- |
| Verified owner/admin with platform approval | Yes | Yes |
| Verified ordinary member with an explicit app-use grant and platform approval | Yes | No |
| Verified invited member awaiting general approval | Only the granted app, with accepted same-email member invitation and both feature flags enabled | No |
| Member without a grant, outsider or unverified identity | No | No |

`app_gateway_bindings.environment` is operator-owned and restricted to
`published` or `preview`. New and previously unclassified bindings default to
preview. The service role cannot change classification. Browser/machine request
bodies cannot select or override it. Binding lookup and each fresh authorization
use database state; code issuance and redemption pass the binding's environment
into current identity lookup. Generic app-use permission lookup retains its
published-use meaning and does not authenticate or protect traffic by itself.

Codes, service credentials and app sessions already bind to an exact binding;
they cannot cross into another environment of the same app. Environment changes
permanently remove that binding's pending codes and active sessions. Reversing
the classification cannot revive them. Existing role, verification, membership,
grant and platform logout invalidation also remains. Approval does not turn an
ordinary member into a preview manager. Demoted administrators must not retain
preview access through their app-use grants.

## Migration and cutover

This PR supplies migration code, not a production migration or feature enablement.
Apply `20261024_gateway_environments.sql` after the existing gateway and platform
session migrations through the normal reviewed release process.

1. Keep gateway feature flags disabled and quiesce older issuers/consumers.
2. Apply the ordered migrations, including this final environment migration.
3. Release all consumers that enforce the new classification before enabling
   private traffic. Older code ignores it and is unsafe for previews.
4. Verify actual runtime/release ownership and explicitly classify only real
   published origins as published. Do not infer publication from an existing
   binding or a working public URL. All unclassified records remain previews.
5. Require fresh app login. The first upgrade deletes earlier app codes/sessions
   because they were issued without this boundary. Platform logins, user records,
   grants and machine credentials remain. Rerunning the migration preserves
   classified records and fresh credentials; unchanged classification does too.

Rollback must disable private traffic and invalidate app credentials before any
older authorization code runs. Dropping the column or reverting the code while
preview bindings remain enabled reopens member access. Do not restore old app
credentials from backup. No automatic down migration is supplied.

## Evidence and limits

Seven policy regressions fail against the exact parent store/identity modules
with the new migration and explicitly published test fixtures. Candidate
verification passes all 137 unit files / 623 tests and eight PostgreSQL files /
100 tests, including 12 new database cases. Typecheck, lint, worker compilation,
configured production build and diff checks pass. Existing dynamic build tracing
warnings remain.

Database coverage includes default-deny classification, owners/admins, approved
and waiting-list members, stale credentials, same-app environment crossover,
service-key binding, demotion, reclassification races, privilege/constraint
checks, and upgrade/rerun behavior. Installed Better Auth signed cookies exercise
the actual handoff route; authenticated machine credentials exercise redemption
and authorization routes. Approval responses are mocked and verified identities
use SQL fixtures in a disposable local PostgreSQL 16 database. These are local
server/database checks, not rendered invitation/publishing UI, real email/OAuth
or hosted private-app proof. The existing browser bootstrap applies the new
migration after older migrations.

Pinned Doctor 0.9.18 completes all ten changed source/test files at 100/100.
The complete unfiltered 591-file scan remains 83/100, zero errors / 37 warnings
across 26 files. No suppression, category filter or threshold change. The
disposable local database is stopped after verification.

This is a control-plane authorization boundary. It does not map a binding to
trusted upstream code, prevent direct-origin bypass, proxy HTTP/WebSockets, or
separate DynamoDB/S3/secrets. Runtime routing and isolated resources must use the
same verified app/environment association before publication can be claimed.
Existing public applications are not made private by this metadata. The full
repository >=95 and complete-feature production gates remain unmet.
