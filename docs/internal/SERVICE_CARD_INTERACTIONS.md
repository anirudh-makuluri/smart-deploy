# Service card actions and keyboard access

The repository service list previously put the live deployment link inside its
workspace button. This violates the [HTML button content model](https://html.spec.whatwg.org/multipage/form-elements.html#the-button-element)
and combines two independently focusable actions. The initial DOM regression
observed the nested link against the exact parent at `fa418628`.

The card now has separate native button and link targets. The workspace button
covers the card surface and gets its accessible name from the visible service
name, root path and status. Visual content lets pointer events reach that
button; the later positioned link receives its own clicks without propagation
workarounds. Its existing new-tab and opener isolation behavior remains.
The link uses ordinary paint order, so it cannot escape above outside overlays
through a global z-index. Chromium caught that layering problem in the first
candidate; removing the unnecessary index fixed the failing hit-test.

`DeployConfig` and `resolveDeploymentStatus` remain the source of deployment
state. A typed, exhaustive presentation map preserves all six statuses and
distinguishes an undeployed service from a saved draft. The catalog header and
card presentation are separated from the list controller. The header preserves
refresh/add actions, visibility guards, busy state and submission behavior.
The original list's measured cyclomatic complexity was 17; the final targeted
complexity and nested-control diagnostics are removed without suppression.

## Evidence boundaries

Permanent DOM tests cover the separate controls, keyboard activation, URL click
isolation, all six deployment statuses, absent deployments, accessible paths,
refresh, add-service submission and busy controls. The existing tests remain.

A local Chromium harness bundles the actual components and exact parent
source with synthetic repository/deployment data and an in-memory workspace
callback. It loads the production CSS, uses a controlled font and a public-only
browser environment shim, intercepts the synthetic destination, and blocks
unexpected external requests. This is isolated component evidence, not a
hosted/authenticated application or AWS deployment test.

The browser checks both keyboard targets and visible focus, full-card text and
padding hit-tests, separate new tabs with no opener, long-URL truncation, page
overflow and outside-overlay precedence. It runs at 1280px dark/LTR and 390px
light/LTR and dark/RTL, including reduced-motion preference. Normal-state
screenshots are compared against the parent; focus states are also inspected.
These are Chromium viewport checks, not a complete device or assistive-technology
audit. No performance improvement is claimed.

The first complete unit attempt failed to load seven suites after temporary
transform-cache files disappeared; the other 129 files and 587 executed tests
passed. The cause of deletion is unknown. Older verification directories were
also missing from global Temp. All tests were rerun unchanged using a private
child-process TEMP/TMP directory, with evidence retained outside global Temp.
The successful rerun passed 136 files / 598 tests. The header change then added
two focused action tests and required a further complete run.

Canonical rule pages reported plugin 0.9.3 while the pinned scanner is 0.9.18;
the published nested-control description also differed from the observed
cross-type diagnostic. Matched local rule explanations, the HTML standard,
source inspection and reproduced DOM/browser behavior establish applicability.
No diagnostics were suppressed or thresholds lowered.

This increment changes client interaction and presentation. Private gateway,
origin isolation, AWS app data, app-centric publishing, scoped tools and usage
controls, full repository >=95 and integrated rollout acceptance remain separate
gates. No production migration, provider connection, invitation email, cloud
resource, worker start, merge or deployment is performed by these checks.

Final local checks pass: 136 unit files / 600 tests, including all 15 service
list tests; full typecheck, lint, worker compilation, configured production
build and diff checks. The final header change received another complete unit
run and build. All three Chromium cases passed against that build's CSS,
including overlay precedence and opener isolation. Each normal-state baseline/
candidate image comparison had zero changed pixels. Existing dynamic build
tracing warnings remain. Local fixture servers are closed after verification.

Pinned Doctor 0.9.18 completes all three changed source/test files at 100/100
with no findings. The complete unfiltered 589-file rollout scan remains 83/100
while warnings drop from 40 to 38 and affected files from 28 to 27, with zero
errors. The clean parent scan covered 588 files at 83/100. Scores are reported
directly by the scanner; no projection, suppression or lowered threshold.
The full >=95 and complete-feature production gates remain unmet.
