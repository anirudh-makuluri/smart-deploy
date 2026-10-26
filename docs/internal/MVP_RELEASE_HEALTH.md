# MVP release health

This cleanup removes the repository-wide findings blocking the AWS user-flow
demonstration. It does not provision, migrate or enable private apps in production.
The baseline is the exact app-document-data head
`7699bdc92e034ec762475a5d4a476ca65e67922a`.

The initial complete, unfiltered React Doctor 0.9.18 scan reported 84/100,
37 warnings and no errors. The view/response changes reach an intermediate
92/100 with one remaining GitHub dispatch warning. The separate dispatch
follow-up clears it; the combined candidate reaches 100/100 without suppressions
or configuration/threshold changes. Both changes must reach the release candidate
before the repository's >=95 requirement is satisfied.

## View and response changes

- Extract cohesive navigation, status, log, metadata and editor sections while
  preserving parent state, callbacks, DOM structure and visible copy.
- Share the identical scan/feedback progress footer and workflow chain; retain
  their separate workflow definitions and stream formatting.
- Transition the properties actually changed by each control, including progress
  width and active-state scale. No measured rendering speedup is claimed.
- Require stable database IDs for sortable/paginated admin rows.
- Check failure-analysis HTTP status before interpreting success fields; validate
  listener JSON before selecting an AWS listener ARN.
- Stream analytics responses with their original status and sanitized headers,
  including upstream failures. Do not forward platform credentials or cookies.

Regression checks cover progress state changes, compact/expanded landing states,
delayed painted content, failure payloads, malformed listener evidence and proxy
streaming/cancellation. Existing deployment, history, navigation and log tests
remain in place. A first server-module import exceeded one approval unit test's
five-second request timeout; import now belongs to `beforeAll` fixture setup,
with individual request-test deadlines preserved.

## Separate GitHub dispatch follow-up

Independent deployment rows use at most two reservation/enqueue pipelines per
webhook. Each row keeps its existing transaction, ownership, run snapshot and
queue-failure finalization. Admission stops on failure; already-admitted work is
drained before the webhook rejects. One other dispatch can therefore finish when
a sibling fails. This is a bounded control-plane change, not a change to ECS
worker concurrency or a global AWS spending limit.

Tests hold queue operations open to verify the bound, stop/drain behavior and
reservation errors. Actual PostgreSQL tests verify the bound against committed
reservations and duplicate concurrent webhook deliveries. A controlled four-job
experiment with injected 40ms queue IO measured serial samples of 187–197ms and
bounded samples of 92–94ms. This is synthetic evidence, not AWS latency proof.
The new default-path tests also caught the existing detached WebCrypto
`randomUUID` call; the fallback now invokes it on its receiver.

CI runs the full pinned Doctor scan and rejects incomplete scans, skipped checks,
missing scores, errors, scanner drift and scores below 95. Eight synthetic gate
checks cover acceptance and those rejection conditions. The command is full and
unfiltered; a changed-file scan is not the release gate.

## Release boundary

The final combined working candidate passes 158 unit files/1,117 tests, 10
PostgreSQL files/148 tests, 33 real DynamoDB Local cases, two compiled native TLS
process cases, 15 compiled private-app browser cases and five compiled public/
analytics browser cases. Typecheck, lint, worker/workload compilation, production
build and diff checks pass. The complete 668-file Doctor scan is 100/100 with no
skipped checks. The disposable database and fixture servers are stopped. Required
Linux container and exact-head PR checks remain separate CI evidence.

Local verification and passing CI do not establish hosted acceptance. The
private runtime loader/data adapter, bounded demo startup and durable teardown,
valid ALB/ACM certificate, reviewed platform migrations and actual creator/member/
outsider acceptance remain release prerequisites. Agent tools and the Nginx
migration are deferred under the user's latest MVP scope. Keep billing #85
separate. No production configuration, cloud resources or provider connections
are changed by this cleanup.
