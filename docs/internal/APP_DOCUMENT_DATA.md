# App document storage and deleted-data retention

This is a trusted broker storage component, with no public route, customer AWS
credential, production caller or provisioned table. It starts the DynamoDB
document path; S3 files, list/query APIs and the complete data broker remain
separate work. Existing platform Better Auth/Supabase dependencies stay intact.

## Namespace and writes

Use an explicitly configured table with string partition key `pk` and sort key
`sk`. One app UUID owns a partition. Document and usage keys include preview or
published environment plus bounded collection/document identifiers. They do not
include a release or runtime identifier, so new code does not relocate app data.
Publishing code does not copy preview documents, files or secrets.

Initialization atomically creates app control and both environment usage rows.
Every initialization is conditional; retrying it cannot reset counters, resurrect
a deleted app or reuse a purge tombstone. Each environment requires explicit
operator limits, with no default allocation. The implementation bounds a document
to an 8 KiB JSON object, finite numbers/safe integers, and depth 16. Large integers
must be strings. Identifiers cannot inject separators or another namespace.

Reads use a transactional control/document/usage snapshot. Writes and single
document removals require the expected opaque UUID version token; creation
explicitly expects absence. A new token on every write prevents old updates or
deletes from matching a document ID that was removed and recreated. A write
transaction checks the active app lifecycle generation, changes
the document and updates counters under current cap/underflow conditions. Failed
writes do not reserve bytes; concurrent writers cannot exceed the namespace cap.
Logical charged bytes include canonical UTF-8 JSON plus conservative metadata/key
overhead. This is a storage reservation, not exact DynamoDB metering or a complete
AWS budget. Requests, denied attempts, retries, transfer, files, backups and all
other service costs still need global admission before provisioning.

The caller owns and closes the underlying DynamoDB client and must configure
bounded timeouts/retries/admission. On an ambiguous transport failure a write may
have committed: read and reconcile its version instead of blindly retrying. An
old version precondition protects the current record. Absence is not a permanent
idempotency receipt after a later deletion; API reconciliation must account for
that history rather than automatically replaying an ambiguous request.

## Seven-day deletion and recovery

The user selected seven days for deleted app documents **and files**, with
immediate access/runtime credential revocation and retained bytes still charged.
`markDeleted` implements the document-data tombstone. It disables data reads and
writes in both environments and preserves every document and usage counter.
Repeating deletion cannot extend the window. Recovery requests admitted before
the deadline can restore data; at/past the deadline recovery is denied. The clock
is trusted broker UTC time, never a request timestamp. In-flight operations may
finish after admission; deployment needs bounded requests and clock monitoring.

Every lifecycle change advances a generation. A write delayed across deletion
and restoration cannot use its old snapshot, even after the app is active again.
`beginPurge` can claim cleanup only at/past the deadline and prevents subsequent
recovery. It deliberately erases no records and releases no quota. The future
cleanup worker must confirm actual document/file/version removal before reducing
retained usage. No TTL is installed on control or usage rows: asynchronous TTL
deletion is neither the recovery cutoff nor proof of reclaimed capacity.

This is **not the whole-app deletion coordinator**. Before exposing deletion, that
coordinator must revoke browser/runtime/data credentials, disable routing and
stop/reconcile compute, then coordinate this data lifecycle with persistent files.
Restoring data must never revive old sessions or runtime credentials. The store
does not authenticate callers: a namespace is not authorization. Browser/tool
adapters must derive app/environment from authenticated server context and enforce
fresh current access; only approved verified managers may change data lifecycle.
No such adapter or production deletion is added here.

## Verification boundaries

`npm run test:documents` uses an actual disposable DynamoDB Local 3.3.2 process,
with explicit dummy SDK credentials and loopback endpoint. The official archive
is SHA-256 pinned. The CLI lacks a bind-address flag; the pinned test-only Java
fixture sets its Jetty connector to literal loopback **before** startup. Changes
to its internal API fail closed. The process is stopped and the checked fixture
directory is removed. CI installs Java 17 and requires this integration suite.
No AWS account table, IAM, S3 object, SQL migration or billable resource is created.

The new tests verify real transaction/condition semantics, namespace isolation,
quota and version races, deletion/recovery boundaries, stale generation rejection,
retained physical records/counters, ambiguous replies, invalid JSON/keys and
redacted corruption errors. Local/CI emulator proof is distinct from IAM, actual
AWS durability, backups/restoration, file cleanup and hosted authorization proof.
See the remediation manifest for final counts and checks. Full repository Doctor
>=95, broker/auth integration, complete $10 enforcement and hosted acceptance
remain release gates.

Local final validation passes 153 unit files / 1,091 tests (four new schema cases),
33 real DynamoDB cases, two compiled workload process cases, typecheck, full lint,
worker/workload compilation, production build and diff checks. Removing the
lifecycle-generation condition lets the stale delayed write commit and causes
the expected regression; exact source is restored. Stored usage initially rejected
DynamoDB key fields; its projection was corrected while operator limits stayed
strict. A verification-runner HTTP auth URL initially affected a secure-cookie unit
expectation; build-only configuration is now scoped to that step and the full unit
suite passes again. Existing filesystem tracing warnings remain. Emulator
processes/fixtures are cleaned and the disposable local PostgreSQL is stopped.

Doctor 0.9.18: complete six-file scan 100/100 without findings; complete unfiltered
656-file scan stays 84/100, zero errors and identical 37 warning IDs in 26 files.
No suppression or threshold change. Unchanged PostgreSQL/browser/container checks
pass in exact parent #122 CI; this PR adds a required emulator transaction check.
Its own CI result is separate from local proof and does not establish hosted AWS
acceptance. No production state or AWS account resources are changed.

Sources: [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html),
[expired TTL records and storage costs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html),
and [official local emulator setup](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html).
