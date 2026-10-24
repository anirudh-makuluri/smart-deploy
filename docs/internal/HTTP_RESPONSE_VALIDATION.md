# Repository and API response validation

Repository inspection now rejects denied requests, malformed trees, truncated
trees, and failed build-file downloads. Previously a GitHub error body without a
`tree` field became a successful empty repository and could reach the model. The
analysis route returns a controlled 502 without invoking a model when inspection
fails. Empty file contents remain valid. Both the tree and important-file reads
use the selected branch; content requests previously defaulted to the repository's
default branch. This does not establish an immutable snapshot: deployment still
must use `DeployConfig.commitSha`.

GraphQL and analysis-save clients check HTTP status before consuming success
payloads. Non-JSON error responses retain their HTTP status in the error message.
Successful responses must contain the expected object envelope; an analysis-save
response must explicitly contain a string or null `responseId`. A malformed 200
response no longer appears to confirm a save. Structured GraphQL/provider error
messages remain available. GitHub App token exchange also rejects malformed
success bodies without masking HTTP failures with property-access errors.

The regression tests exercise denied/incomplete/malformed repository metadata,
selected-branch URLs, empty files, error bodies, malformed success envelopes,
installation-token responses, and the actual repository helper through the
analysis route. The route test supplies a GitHub 403 and confirms no model call.
All upstream network responses are local test doubles; no model, GitHub mutation,
cloud resource, production migration, or deployment is invoked by these tests.

Scope limits: this patch does not introduce inspection size quotas, immutable
source fetching, narrower installation-token permissions, a private runtime, or
the DynamoDB/S3 application-data broker. Those remain separate rollout work.
The user selected DynamoDB documents and S3 files for the on-demand pilot, with
an additional AWS budget of at most $10/month. Existing platform authentication
and Supabase dependencies remain in place.

Verification: all 129 unit files / 501 tests, full typecheck, lint, worker
compilation, and production build pass. The build retains existing dynamic
repository tracing warnings and local missing-auth-configuration warnings; it
does not establish live authentication or application-runtime behavior.
Pinned React Doctor 0.9.18 analyzes all eight changed TypeScript files at 100/100
with zero diagnostics. The unfiltered full scan covers 570 files, is complete,
and increases from 81 to 82/100 (zero errors, 42 warnings, four fewer warnings).
The required full-repository 95/100 and full-feature release gates remain open.
No scanner suppression or threshold change was made. The first attempted full
test run was stopped after Windows npm discarded the worker-limit argument and
oversubscribed the machine; the successful run invokes Vitest directly with
`node node_modules/vitest/vitest.mjs run --maxWorkers=2`.
