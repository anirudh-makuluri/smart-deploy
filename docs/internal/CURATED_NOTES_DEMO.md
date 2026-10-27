# Curated notes application

`demo/notes` is the one deliberately labelled application used to demonstrate
the private-app MVP. It is not an arbitrary repository launcher. The dependency-
free Node server serves local HTML/JavaScript/CSS, binds to loopback for the
workload TLS sidecar, and accepts only v1/v2/preview release labels. It does not
authenticate users, accept document POSTs, store local user data or receive
platform/cloud credentials. The gateway must enforce authentication and prevent
direct-origin bypass before this application is exposed.

The browser uses only the same-origin reserved document broker, with the fixed
`team-notes/shared` document address. App/environment scope and credentials come
from the gateway; the browser never supplies them. Saved notes are limited to
1,800 characters and the existing UTF-8 JSON limit. The last observed document
version is required when saving. Initial creation requires an observed empty
read. Missing/unrelated responses, conflicts and network uncertainty preserve
the draft and block another save until explicit Reload saved note. No automatic
write retries or optimistic success. Access denial clears the displayed note
and retires the controls; page retirement cancels work and rejects late results.

The app's v1/v2/preview images use the same pinned Node base as the workload TLS
listener. Build from `demo/notes/Dockerfile` with `NOTES_RELEASE` set explicitly.
Run as UID/GID10001 with a read-only filesystem and no task role or extra
privileges. Persistent state belongs to the gateway's documents service. The
same address resolves independently in preview and published environments.

Local proof:17 client/actual HTTP tests, typecheck and focused lint pass. An
actual Node-process browser test loads the real assets under their CSP, saves a
note, replaces v1 with v2, reloads the retained note and reconciles an uncertain
save. Its document broker is controlled fixture data, so it is not AWS storage
or authentication proof. The390px mobile view was visually inspected without
horizontal overflow. Complete746-file unfiltered Doctor0.9.18:100/100,zero
findings/skips,no suppression. Parent#134 separately passes full release CI.

CI builds the actual notes image and requires Linux Docker proof of non-root,
read-only execution, the exact shipped files, readiness and graceful shutdown.
Local Docker is unavailable; that check remains pending until exact-head CI.
Browser setup initially hit Playwright's CommonJS/ESM transforms; launching the
real Node entrypoint outside those hooks fixes the fixture and adds process
proof. Failed fixture attempts remain separate from final passing evidence.

AWS images/resources, quota initialization, role trust, TLS keys, release source
records/catalog/bootstrap, actual gateway versions and persistence/access/
revocation/teardown still need composition and hosted acceptance. This slice
creates no AWS resources and changes no platform migration, feature flag,
provider connection, account, email or production deployment.
