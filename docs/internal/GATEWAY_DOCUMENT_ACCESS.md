# Browser document broker

The trusted native gateway can explicitly enable `documentsEnabled` for a managed
pilot runtime. It accepts `POST /__smartdeploy/documents` with the same get/put/
remove body as the machine API, excluding the token. JavaScript uses a normal
same-origin fetch; the gateway reads the host-only HttpOnly app-session cookie.
It never forwards the data request to customer HTTP, returns a gateway credential
or accepts app/environment/table/user/binding/token fields from the browser.

This option is required and must be false for routes without the completed data
setup. Disabled paths and encoded/case/trailing-slash reserved variants never
fall through to customer routing. The platform's separate document flag and
explicit app/table configuration are still required. A gateway option does not
initialize data or grant access.

Requests require the exact configured app origin and same-origin Origin proof.
Sibling-origin forms/fetches, missing/duplicate session cookies, query parameters,
other methods, non-JSON/compressed bodies and streamed input above 32 KiB fail.
Every operation calls the platform document API, where the current session,
verified identity, grant and selected managed runtime determine scope. Browser
Authorization, cookies and claimed identity headers never become machine headers.

Responses preserve only validated data or a fixed redacted error/status. Reads
may return null; writes must match the requested address and normalized JSON with
a fresh UUID version; deletes require an explicit receipt. Machine replies are
bounded to 32 KiB, with no redirects or foreign endpoints. Existing authorization
responses retain their 4-KiB limit. No CORS access is added. All data responses
are private/no-store, same-origin and non-frameable.

The broker limits active operations to two, bounds body plus transport to five
seconds and aborts on browser disconnect or gateway retirement. Machine calls
also keep the configured control deadline. There are no mutation retries:
unavailable writes can have committed, so read the current document before
deciding what to do next. These process limits are not a global spending limit.

The shared document encoder now checks both input and normalized UTF-8 bytes.
For example, 1,000 `1e-6` values expand a 5,012-byte JSON object to 9,012 bytes;
that write is rejected before storage rather than committing a record that later
fails the read/response contract. Lone-surrogate escaping has the same bound.

The browser fixture exercises actual HTTPS/native framing, HttpOnly cookies,
same-origin fetch, save/read/conflict/delete, live denial with an unchanged cookie
and sibling-origin form rejection. Its control transport and documents are
explicit in-memory fixtures; they do not establish real SQL, IAM, DynamoDB,
redeployment, identity-provider or hosted acceptance. Those remain distinct proof.

No runtime is started, data resource created, flag enabled, migration applied or
production release performed by this adapter. The trusted runtime loader,
bounded AWS demo setup/cleanup and full hosted user-flow acceptance still follow.

Final local proof: 162 unit files / 1,209 tests, 10 PostgreSQL files / 151 tests,
33 DynamoDB Local cases, two native TLS process cases, 15 compiled private-app
browser cases, five compiled public/analytics cases and 21 combined cookie/native
browser cases pass. The three new document browser cases are included in that
21; the sibling-form case confirms the rejected request carried the app cookie.
Typecheck, lint, production/worker/workload builds pass. Complete unfiltered
React Doctor 0.9.18: 100/100, 677 files, zero errors/warnings/skips. The encoding
fix was followed by a full unit rerun and storage/worker verification.
