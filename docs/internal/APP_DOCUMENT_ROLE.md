# App-scoped document broker credentials

The single-app document API now also requires `APP_DOCUMENTS_ROLE_ARN`. Missing
or mismatched configuration fails closed before an AWS client is created. Keep
`PRIVATE_APP_DOCUMENTS_ENABLED=false` until the dedicated role, trust, table,
initial limits and deployed authorization have been verified. This change does
not create or configure any AWS resource or enable the API.

`documentRolePolicy` defines the permission ceiling for the operator-provisioned
role and each assumed session: one exact table ARN, one exact `APP#<app-id>`
partition, and the underlying item permissions needed for transactions. All
leading keys must match, and missing leading-key context is denied. Get/put/
update/delete require the transaction enclosing-operation context. Condition
checks have a separate statement with the same table/app restrictions: the
[AWS service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_dynamodb.html)
does not support `EnclosingOperation` on `ConditionCheckItem`; it authorizes the
check inside `TransactWriteItems`, with no standalone condition-check API.
There are no query, scan, table administration, S3, secrets or IAM permissions.

The role and table must belong to the same account and configured AWS region.
The pilot accepts ordinary role names, not role paths. Credentials come only from
an explicit regional STS endpoint and a 900-second AssumeRole request carrying
that permission ceiling. The adapter validates the returned account/role/session
identity, mandatory credential fields and a usable short expiration before
constructing DynamoDB. No default-platform-credential fallback, provider-error
details, SDK logging, credential disk persistence or shared credential cache is
introduced. DynamoDB receives only the temporary credentials. The platform's
existing credentials are used to request the restricted session, not for this
document client's data operations.

Admission covers STS as well as DynamoDB, with at most two pending operations in
one process. Cancellation and bounded one-attempt SDK timeouts apply to both.
Slots remain occupied until the actual SDK work settles; late cancelled
credential results cannot create a DynamoDB client. Clients are destroyed and
slots released on success or failure. This is not a global traffic/spending cap.
Fresh SQL/app-session authorization still chooses the scope. IAM isolates the
app partition; preview/published separation remains the broker's verified
environment plus separate sort keys. Already-admitted work may finish during a
permission change, and an uncertain write must be reconciled before retrying.

Final serial local proof: 162 unit files/1,180 tests (23 new), including 33 focused
credential/backend cases; all 33 DynamoDB Local transaction/lifecycle cases;
15 compiled private and five public browser cases; typecheck, full lint,
private/public production builds and worker compilation/alias resolution pass.
Complete unfiltered React Doctor 0.9.18: 100/100 over 676 files, zero findings or
skips, no suppression. SQL/workload implementations are unchanged; standalone
SQL/workload suites pass exact parent #126 CI and were not repeated locally.
Owned PostgreSQL, DynamoDB Local and browser fixtures stopped.

Read-only AWS validation of the generated policy returns zero Access Analyzer
findings. All 17 IAM custom-policy simulations pass: five positive item/check
permissions and 12 denials including foreign/mixed/missing app keys, direct
writes, scans, queries, table deletion, another table and secret access. An
initial combined statement passed basic validation but failed the condition-check
simulation. Diagnostic simulations isolated the unsupported condition; the
statement was split, focused tests and worker compilation rerun, and the final
full suite restarted after stopping the preliminary verification. No failed or
interrupted preliminary run is counted as final proof.

Simulations use fixture resource ARNs and do not prove deployed trust, actual
assumed-role calls, organization/resource policies or live DynamoDB access.
Provision the exact role policy and trust only the verified platform principal;
customer tasks must not assume it. Repeat positive document transactions and
cross-app denials with the actual deployed session before enabling the API.
Trusted publishing, bounded demo provisioning and hosted persistence/revocation
acceptance remain release gates. No IAM policy/role, provider connection,
production configuration, migration, data, cloud resource, worker state, rollout
merge or deployment was changed. Billing #85 remains separate.
