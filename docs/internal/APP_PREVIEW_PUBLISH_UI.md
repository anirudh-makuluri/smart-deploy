# Creator preview and publish controls

The Apps & team page shows a Preview & publish panel when the workspace,
gateway and publishing flags are enabled. The worker must have its bounded
operator-owned prepared release catalog; this panel does not provision resources
or launch an arbitrary repository. App creation and colleague sharing remain
separate actions.

Inspection uses the authenticated worker's apps:runtime acknowledgement channel.
The browser sends only app/release/environment/correlation/current-runtime IDs.
It receives minimal release labels, public HTTPS origins, expiry and selection
eligibility. It does not receive AWS metadata, certificates or service keys.
Eligibility and an acknowledged selection are not application-health claims:
the gateway reconciles asynchronously and the selected app must be observed.

Publishing requires an explicit click and the reviewed current-runtime ID.
Preview selection is separate, and only the published link has a sharing-copy
action. Preview data and secrets are never copied. Colleagues with app-use
access remain limited to the published application. The existing server-side
session, verification, approval and workspace management checks remain decisive.

Commands use a volatile, bounded acknowledgement with no reconnect replay.
Changing the user or the same user's login session retires the socket/token
cache. Results are validated against the exact request/app and expected selected
release, including catalog/environment consistency. A missing or malformed
acknowledgement leaves mutation controls blocked until explicit reconciliation;
an already-admitted server operation may still have committed. Disconnect removes
the active panel, and local expiry removes all actions and application links.

The panel follows existing app/workspace query scoping and remount boundaries.
Socket credentials and polling bodies are excluded from analytics network
recording alongside existing auth and invitation paths. No provider recording
settings are changed. Clipboard writes occur only after the creator clicks Copy.

Verification includes strict acknowledgement, actor/session retirement, uncertain
write and expiry tests, plus the compiled Next.js UI over the actual worker
authentication/Socket.IO/session guard. Browser release metadata is a controlled
fixture, not AWS deployment evidence. Clipboard unit tests mock the browser API;
compiled browser checks do not modify the operating-system clipboard. Hosted
AWS version/persistence/revocation and bounded teardown remain release gates.

This slice is based on the integrated release baseline containing sharing,
cleanup, document credentials and trusted worker control. Billing and the agent
flow remain separate; no production configuration, migration, runtime startup,
provider connection or deployment is performed by adding these controls.

Final serial local proof: 183 unit files/1,446 tests (24 added), ten PostgreSQL
files/155 tests, 33 DynamoDB Local cases, two gateway and two workload process
cases, all 23 compiled private and five public browser cases pass. Full lint,
types, worker/workload compilation and private/public production builds pass.
Complete unfiltered React Doctor0.9.18:100/100 across737files,zero findings or
skipped checks,without suppression. The390px publishing surface was visually
inspected and has no horizontal overflow. Clipboard proof is unit-mocked only.

The first compiled browser run caught a selector falling back to retired v1
after successful v2 selection. The fallback now keeps the selected release when
no newer eligible choice exists, with a unit assertion and passing compiled
browser proof. An initial test-handler diagnostic was repaired with explicit
async error handling. A final single-case visual run preserved the screenshot
outside the public suite's cleaned output directory; no failed run is counted
as passing. Hosted AWS acceptance remains outstanding.
