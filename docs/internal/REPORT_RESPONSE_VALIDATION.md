# Report submission confirmation

The report sheet previously treated any successful HTTP status as a saved
report. An HTML response, empty object or false acknowledgement could show
success, close the sheet and discard the draft. HTTP errors were already
rejected; the defect was the missing successful-response contract check.

The client now requires `ok: true` and a canonical UUID report ID, matching the
existing route response and PostgreSQL `user_reports.id` schema. Extra response
metadata remains allowed. HTTP failures use the existing shared error reader;
unconfirmed responses retain the draft and restore explicit retry. Only a valid
receipt clears the form and closes it. No route or database schema changed.

Fourteen DOM regressions cover malformed acknowledgements, HTML, HTTP errors,
network failure, valid receipts and retrying the same draft. Ten failed against
the exact parent before the fix. All fourteen now pass; the complete unit run
passes 137 files / 614 tests. Typecheck, lint, worker compilation, configured
production build and diff checks pass. Existing dynamic build tracing warnings
remain.

Local Chromium loads the actual sheet, toast implementation and production CSS
against both exact-parent and candidate source. A synthetic loopback endpoint
returns HTML, a false acknowledgement and then a valid receipt. The parent
incorrectly closes and loses the draft on HTML. The candidate retains the same
draft through both invalid responses and submits identical payloads on explicit
retries; the third, valid receipt closes and resets it. The retained-draft
screenshot was visually inspected. Servers close after verification. This is
isolated browser/transport evidence with synthetic data, not authenticated,
hosted, Supabase or AWS end-to-end proof. Retrying an ambiguous result may still
create a duplicate report; this increment introduces no idempotency protocol.

Pinned Doctor 0.9.18 completes both changed source/test files at 100/100. The
complete unfiltered 590-file scan remains 83/100, with zero errors, 37 warnings
and 26 affected files, down from 38 warnings / 27 affected files in the clean
parent. No suppression or threshold change. Canonical rule guidance reported
an older plugin version; matched local guidance, source inspection and the
reproduced data loss establish this fix.

Stacked on service-card PR #107. Full-repository >=95 and complete-feature
production gates remain unmet. No production migration, provider change,
invitation email, cloud resource, worker start, merge or deployment is performed.
