# Machine-only document readiness

`POST /api/gateway/readiness` is a default-off operational check for the selected
managed gateway. It uses the existing gateway service authentication, requires
an exact binding assertion and rejects browser Origin/cookies/fetch context,
query parameters and insecure requests. The only accepted JSON body is `{}`,
bounded to 64 bytes. No caller-supplied app, environment, table, role, user or
session is accepted.

The SQL store derives app/environment only from an available current managed
binding. The broker applies its configured one-app allowlist and dedicated
temporary document-role credentials, then transactionally reads the existing
control and environment quota rows. Deleted/uninitialized/unavailable data fails
closed. No document content is read and no control, quota, document, session or
credential is written. The public success reply is only `{ "ready": true }`.
Errors do not disclose AWS identity, credentials, table data or quota values.

Readiness and user document work share the existing two-slot process admission
bound, including pending STS work; cancellation does not release admission until
the underlying work settles. The HTTP deadline is four seconds and late results
are discarded. AWS retries remain disabled and clients are destroyed afterward.

This permits verification of the actual hosted broker role and initialized
storage without manufacturing a user session. It proves neither a user's right
to use an app nor save/redeploy persistence, colleague access or revocation.
Those use the existing full session-authorized document API and their separate
tests. The manual two-account hosted test is deferred at the user's request.
