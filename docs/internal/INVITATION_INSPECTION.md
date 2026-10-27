# Inspect an invitation before accepting

`POST /api/workspace-invitations/inspect` accepts the same strict JSON
`{ "token": "<invitation token>" }` body as acceptance. It returns only
`workspace: { id, name }`, the invited `role`, and `expiresAt` as an ISO timestamp.
It never consumes the token, joins the workspace or creates an app-use grant.
The role describes the invitation; it does not promise an overwrite of existing
membership. Acceptance still preserves an existing member's role.

Both operations share current invitation validation: a live team workspace,
unexpired/unrevoked/unconsumed hash-only token, current database email matching
the invitation, verified identity, and current inviter authority. The existing
workspace/invitation locks serialize these reads with membership, revocation and
acceptance transactions. Inspection creates no reservation; acceptance performs
the same checks again and retains its atomic single-use update. A previously
displayed invitation can become unavailable before acceptance.

The endpoint requires the workspace feature flag, a fresh Better Auth session,
the configured HTTPS platform origin, POST, same-origin Origin/Fetch Metadata,
no query string and bounded uncompressed JSON. Tokens stay in the request body;
the API supplies no token-in-URL mechanism. Responses are `no-store` and
`no-referrer`; unexpected errors are redacted. The exact inspection path is
exempted from the broad management approval gate so its narrower invitation
policy can run. Similar prefixes remain protected.

With waiting-list approval enabled, unapproved invitees can inspect only
ordinary-member invitations, and only while the private-app feature is enabled.
Administrator invitations still require platform approval. Inspection does not
unlock deployment, workspace management, app use or unpublished previews.

This is backend support for an informed confirmation screen. It does not add
the screen, login return flow, invitation-link transport, email delivery or
runtime hosting. Browser instrumentation and analytics must not receive raw
invitation credentials when that UI is implemented. No app-preview audience
decision is inferred here.

PostgreSQL tests verify repeated inspection without mutation, minimal returned
fields, current email/verification, invalid/expired/replaced/revoked/consumed
tokens, inviter demotion/removal, member-only policy and fresh acceptance after
revocation. Integration tests call the actual route with installed Better Auth
signed cookies and a disposable PostgreSQL 16 database. Approval service
responses are mocked and verified identities are established by SQL fixtures;
this does not prove real email/OAuth, a rendered browser flow or hosted access.

The first candidate retained a workspace-ID variable after moving validation
into the shared loader. This introduced acceptance failures in 48 of 88 database
tests; the failure was fixed by using the validated workspace's ID. The entire
unchanged database suite then passed, including the existing acceptance cases.
No test was removed or suppressed. All fixture data is local and disposable.

Final unit coverage passes 137 files / 621 tests. The complete PostgreSQL suite
passes eight files / 88 tests, including nine new store/route integration cases.
Both focused API suites pass all 54 tests. These checks run serially, with at
most two unit workers and one database worker. Verification artifacts and the
disposable database live outside global Temp.
Typecheck, lint, worker compilation and configured production build also pass;
existing dynamic build tracing warnings remain. The disposable PostgreSQL
server is stopped after verification. No rendered browser audit was run for
this backend increment.

Pinned Doctor 0.9.18 completes all eight changed source/test files at 100/100.
The complete unfiltered 591-file scan remains 83/100, zero errors / 37 warnings
across 26 files, matching the verified parent source snapshot. No diagnostic
suppression, category filter or lowered threshold is used.

No migration, feature enablement, production data change, provider connection,
invitation email, billable resource, AWS worker start, merge or deployment is
performed by this increment. Full-repository >=95 and complete-feature
production gates remain separate requirements.
