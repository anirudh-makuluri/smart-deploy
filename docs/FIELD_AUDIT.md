# GraphQL Yoga migration — field audit

**Created**: 2026-04-01  
**Last updated**: 2026-04-12  
**Status**: Reference (maintainer map of types and JSON after the GraphQL Yoga migration)  
**Purpose**: Map GraphQL-related types, nullability, and JSON usage for schema and resolver work.

**See also:** [AWS setup](./AWS_SETUP.md) · [GCP setup](./GCP_SETUP.md) · [Multi-service detection](./MULTI_SERVICE_DETECTION.md) · [GraphQL Yoga migration](./GRAPHQL_YOGA_MIGRATION.md)

---

## Executive summary

### Operations Count
- **Queries**: 10
- **Mutations**: 10
- **Root Types**: 8 (Repository, Deployment, DetectedService, RepoServices, DeploymentHistoryEntry, SDArtifacts, etc.)
- **Total Fields to Map**: ~150

### Key Findings
- ✅ Most fields are well-defined in TypeScript
- ⚠️ Some fields have `?` (optional) - need nullable in GraphQL
- ⚠️ `env_vars` stored as string (JSON serialized) - use `JSON` scalar
- ⚠️ `scan_results` is complex nested JSON - define full type or use `JSON` scalar
- ⚠️ Dates stored as ISO strings - use `String` not `DateTime` scalar
- ⚠️ `license` field can be null
- ⚠️ EC2 metadata can be partial (some fields may not exist)

---

## Type-by-type field audit

### 1. Repository (`repoType`)
**Source**: GitHub API mapped by `mapGithubRepoToAppRepo()`  
**Used in**: Query.appOverview, Query.resolveRepo, Query.session, Mutation.refreshRepos  
**Database**: `user_repos` table (stored as JSON in `data` field)

| Field | Type | Nullable | GraphQL | Notes |
|-------|------|----------|---------|-------|
| `id` | string | ❌ No | String! | GitHub repo ID |
| `name` | string | ❌ No | String! | Repo name |
| `full_name` | string | ❌ No | String! | owner/repo |
| `html_url` | string | ❌ No | String! | GitHub repo URL |
| `language` | string | ✅ Yes | String | Can be empty string (`""`) |
| `languages_url` | string | ❌ No | String! | GitHub API endpoint |
| `created_at` | string | ❌ No | String! | ISO date string |
| `updated_at` | string | ❌ No | String! | ISO date string |
| `pushed_at` | string | ❌ No | String! | ISO date string |
| `default_branch` | string | ❌ No | String! | e.g., "main" |
| `private` | boolean | ❌ No | Boolean! | true or false |
| `description` | string \| null | ✅ Yes | String | Can be null |
| `visibility` | 'public' \| 'private' \| 'internal' | ❌ No | RepositoryVisibility! (enum) | - |
| `license.spdx_id` | string \| null | ✅ Yes | License! (object) | license itself can be null |
| `forks_count` | number | ❌ No | Int! | - |
| `watchers_count` | number | ❌ No | Int! | - |
| `open_issues_count` | number | ❌ No | Int! | - |
| `owner.login` | string | ❌ No | String! | GitHub username |
| **latest_commit** | object \| null | ✅ Yes | Commit | Can be null if no commits |
| `latest_commit.message` | string | ❌ No | String! | Commit message |
| `latest_commit.author` | string | ❌ No | String! | Author name |
| `latest_commit.date` | string | ❌ No | String! | ISO date string |
| `latest_commit.sha` | string | ❌ No | String! | Commit SHA |
| `latest_commit.url` | string | ❌ No | String! | GitHub URL |
| **branches** | array | ❌ No | [Branch!]! | Can be empty array |
| `branches[].name` | string | ❌ No | String! | Branch name |
| `branches[].commit_sha` | string | ❌ No | String! | Latest commit on branch |
| `branches[].protected` | boolean | ❌ No | Boolean! | Protection status |

**Graph QL Type**:
```graphql
enum RepositoryVisibility {
  PUBLIC
  PRIVATE
  INTERNAL
}

type License {
  spdx_id: String!
}

type Commit {
  message: String!
  author: String!
  date: String!
  sha: String!
  url: String!
}

type Branch {
  name: String!
  commit_sha: String!
  protected: Boolean!
}

type Repository {
  id: String!
  name: String!
  full_name: String!
  html_url: String!
  language: String
  languages_url: String!
  created_at: String!
  updated_at: String!
  pushed_at: String!
  default_branch: String!
  private: Boolean!
  description: String
  visibility: RepositoryVisibility!
  license: License
  forks_count: Int!
  watchers_count: Int!
  open_issues_count: Int!
  owner: RepositoryOwner!
  latest_commit: Commit
  branches: [Branch!]!
}

type RepositoryOwner {
  login: String!
}
```

**Risks**: 
- `language` can be empty string - handle in resolver
- `latest_commit` can be null if repo is empty

---

### 2. Deployment (`DeployConfig`)
**Source**: Supabase `deployments` table + `data` JSONB field  
**Used in**: Query.appOverview, Query.repoDeployments, Mutation.updateDeployment  
**Database**: `deployments` table (main fields are table columns, rest in `data` JSONB)

| Field | Type | Nullable | GraphQL | Notes |
|-------|------|----------|---------|-------|
| `id` | string | ❌ No | String! | Primary key |
| `repo_name` | string | ❌ No | String! | From table |
| `url` | string | ❌ No | String! | Repository URL |
| `branch` | string | ❌ No | String! | Git branch |
| `commitSha` | string | ✅ Yes | String | Can be missing |
| `env_vars` | string | ✅ Yes | String | JSON serialized object |
| `deployUrl` | string | ✅ Yes | String | Active deployment URL |
| `custom_url` | string | ✅ Yes | String | Custom domain |
| `screenshot_url` | string | ✅ Yes | String | Supabase Storage URL |
| `service_name` | string | ❌ No | String! | Service identifier |
| `status` | 'running' \| 'paused' \| 'stopped' \| 'didnt_deploy' \| 'failed' | ✅ Yes | DeploymentStatus | Can be missing |
| `first_deployment` | string | ✅ Yes | String | ISO date string or undefined |
| `last_deployment` | string | ✅ Yes | String | ISO date string or undefined |
| `revision` | number | ✅ Yes | Int | Can be missing |
| **token_usage** | object | ✅ Yes | TokenUsage | Can be null/missing |
| `token_usage.input_tokens` | number | ❌ No | Int! | If token_usage exists |
| `token_usage.output_tokens` | number | ❌ No | Int! | If token_usage exists |
| `token_usage.total_tokens` | number | ❌ No | Int! | If token_usage exists |
| `cloudProvider` | 'aws' \| 'gcp' | ✅ Yes | CloudProvider | Can be missing |
| `deploymentTarget` | 'ec2' \| 'cloud-run' | ✅ Yes | DeploymentTarget | Can be missing |
| `awsRegion` | string | ✅ Yes | String | e.g., "us-west-2" |
| `awsEc2InstanceType` | string | ✅ Yes | String | e.g., "t3.micro" |
| **ec2** | object | ✅ Yes | EC2Details | Can be null/missing |
| `ec2.success` | boolean | ❌ No | Boolean! | - |
| `ec2.baseUrl` | string | ❌ No | String! | - |
| `ec2.instanceId` | string | ❌ No | String! | AWS instance ID |
| `ec2.publicIp` | string | ❌ No | String! | Public IP |
| `ec2.vpcId` | string | ❌ No | String! | VPC ID |
| `ec2.subnetId` | string | ❌ No | String! | Subnet ID |
| `ec2.securityGroupId` | string | ❌ No | String! | Security group |
| `ec2.amiId` | string | ❌ No | String! | AMI ID |
| `ec2.sharedAlbDns` | string | ✅ Yes | String | ALB DNS name |
| **cloudRun** | object | ✅ Yes | CloudRunDetails | Can be null/missing |
| **scan_results** | object | ✅ Yes | JSON | Complex nested structure |

**GraphQL Type**:
```graphql
enum DeploymentStatus {
  RUNNING
  PAUSED
  STOPPED
  DIDNT_DEPLOY
  FAILED
}

enum CloudProvider {
  AWS
  GCP
}

enum DeploymentTarget {
  EC2
  CLOUD_RUN
}

type TokenUsage {
  input_tokens: Int!
  output_tokens: Int!
  total_tokens: Int!
}

type EC2Details {
  success: Boolean!
  baseUrl: String!
  instanceId: String!
  publicIp: String!
  vpcId: String!
  subnetId: String!
  securityGroupId: String!
  amiId: String!
  sharedAlbDns: String
}

type CloudRunDetails {
  # Expand as needed
}

type Deployment {
  id: String!
  repo_name: String!
  url: String!
  branch: String!
  commitSha: String
  env_vars: String
  deployUrl: String
  custom_url: String
  screenshot_url: String
  service_name: String!
  status: DeploymentStatus
  first_deployment: String
  last_deployment: String
  revision: Int
  token_usage: TokenUsage
  cloudProvider: CloudProvider
  deploymentTarget: DeploymentTarget
  awsRegion: String
  awsEc2InstanceType: String
  ec2: EC2Details
  cloudRun: CloudRunDetails
  scan_results: JSON  # Complex object - use JSON scalar
}
```

**Risks**:
- `env_vars` is JSON serialized - might be null or string - needs parsing on client
- `scan_results` is complex nested structure - consider breaking into separate type or keep as JSON scalar
- EC2 fields only exist when deploymentTarget === "ec2"
- Fields can be undefined vs null - handle in resolver

---

### 3. DetectedService
**Source**: `DetectedServiceInfo` type  
**Used in**: Mutation.detectServices, Query.repoServices

| Field | Type | Nullable | GraphQL |
|-------|------|----------|---------|
| `name` | string | ❌ No | String! |
| `path` | string | ❌ No | String! |
| `language` | string | ❌ No | String! |
| `framework` | string | ✅ Yes | String |
| `port` | number \| null | ✅ Yes | Int |

```graphql
type DetectedService {
  name: String!
  path: String!
  language: String!
  framework: String
  port: Int
}
```

---

### 4. RepoServices
**Source**: `RepoServicesRecord` type  
**Database**: `repo_services` table  
**Used in**: Query.appOverview, Query.repoServices

| Field | Type | Nullable | GraphQL |
|-------|------|----------|---------|
| `repo_url` | string | ❌ No | String! |
| `branch` | string | ❌ No | String! |
| `repo_owner` | string | ❌ No | String! |
| `repo_name` | string | ❌ No | String! |
| `services` | array | ❌ No | [DetectedService!]! |
| `is_monorepo` | boolean | ❌ No | Boolean! |
| `updated_at` | string | ❌ No | String! |

```graphql
type RepoServices {
  repo_url: String!
  branch: String!
  repo_owner: String!
  repo_name: String!
  services: [DetectedService!]!
  is_monorepo: Boolean!
  updated_at: String!
}
```

---

### 5. DeploymentHistoryEntry
**Source**: `DeploymentHistoryEntry` type  
**Database**: `deployment_history` table  
**Used in**: Query.deploymentHistory, Query.deploymentHistoryAll

| Field | Type | Nullable | GraphQL | Notes |
|-------|------|----------|---------|-------|
| `id` | string | ❌ No | String! | UUID |
| `repo_name` | string | ❌ No | String! | - |
| `service_name` | string | ❌ No | String! | - |
| `timestamp` | string | ❌ No | String! | ISO date string |
| `success` | boolean | ❌ No | Boolean! | - |
| `steps` | array | ❌ No | [DeployStep!]! | Array of deployment steps |
| `configSnapshot` | object | ❌ No | JSON | Deployment config snapshot |
| `commitSha` | string | ✅ Yes | String | - |
| `commitMessage` | string | ✅ Yes | String | - |
| `branch` | string | ✅ Yes | String | - |
| `durationMs` | number | ✅ Yes | Int | Duration in milliseconds |

```graphql
type DeployStep {
  id: String!
  label: String!
  logs: [String!]!
  status: DeployStepStatus!
  startedAt: String
  endedAt: String
}

enum DeployStepStatus {
  PENDING
  IN_PROGRESS
  SUCCESS
  ERROR
}

type DeploymentHistoryEntry {
  id: String!
  repo_name: String!
  service_name: String!
  timestamp: String!
  success: Boolean!
  steps: [DeployStep!]!
  configSnapshot: JSON!
  commitSha: String
  commitMessage: String
  branch: String
  durationMs: Int
}
```

---

### 6. SDArtifacts (Scan Results)
**Source**: `SDArtifactsResponse` type  
**Used in**: Deployment.scan_results field, Mutation.prefillInfra response

| Field | Type | Nullable | GraphQL |
|-------|------|----------|---------|
| `commit_sha` | string | ✅ Yes | String |
| `stack_summary` | string | ❌ No | String! |
| **services** | array | ❌ No | [ScanService!]! |
| `services[].name` | string | ❌ No | String! |
| `services[].build_context` | string | ❌ No | String! |
| `services[].port` | number | ❌ No | Int! |
| `services[].dockerfile_path` | string | ❌ No | String! |
| `services[].language` | string | ✅ Yes | String |
| `services[].framework` | string | ✅ Yes | String |
| `dockerfiles` | object | ❌ No | JSON | Key-value of dockerfile contents |
| `docker_compose` | string | ❌ No | String! | - |
| `nginx_conf` | string | ❌ No | String! | - |
| `has_existing_dockerfiles` | boolean | ❌ No | Boolean! | - |
| `has_existing_compose` | boolean | ❌ No | Boolean! | - |
| `risks` | array | ❌ No | [String!]! | Risk warnings |
| `confidence` | number | ❌ No | Float! | 0.0-1.0 |
| **hadolint_results** | object | ❌ No | JSON | Key-value of linting results |
| **token_usage** | object | ❌ No | TokenUsage! | - |

```graphql
type ScanService {
  name: String!
  build_context: String!
  port: Int!
  dockerfile_path: String!
  language: String
  framework: String
}

type SDArtifacts {
  commit_sha: String
  stack_summary: String!
  services: [ScanService!]!
  dockerfiles: JSON!
  docker_compose: String!
  nginx_conf: String!
  has_existing_dockerfiles: Boolean!
  has_existing_compose: Boolean!
  risks: [String!]!
  confidence: Float!
  hadolint_results: JSON!
  token_usage: TokenUsage!
}
```

---

### 7. Response Wrappers
**Used in**: Top-level query/mutation responses

```graphql
type AppOverviewResult {
  repoList: [Repository!]!
  deployments: [Deployment!]!
  repoServices: [RepoServices!]!
}

type DeploymentHistoryPage {
  history: [DeploymentHistoryEntry!]!
  page: Int!
  limit: Int!
  total: Int!
}

type DetectServicesResult {
  isMonorepo: Boolean!
  isMultiService: Boolean!
  services: [DetectedService!]!
  packageManager: String
}

type UpdateCustomDomainResult {
  status: String!
  message: String
  customUrl: String
}

type VerifyDnsResult {
  available: Boolean!
  isOwned: Boolean
  subdomain: String!
  customUrl: String
  alternatives: [String!]
  message: String
}

type CustomDomainResult {
  status: String!
  message: String
  customUrl: String
}

type DnsVerificationResult {
  available: Boolean!
  subdomain: String!
  isOwned: Boolean
  customUrl: String
  alternatives: [String!]
  message: String
}

type ControlResult {
  status: String!
  message: String
}

type DeleteResult {
  status: String!
  message: String
  vercelDnsDeleted: Int
}

type CloneResult {
  message: String!
}

type PrefillResult {
  found: Boolean!
  branch: String
  results: SDArtifacts
}

type RefreshResult {
  status: String!
  message: String!
  repoList: [Repository!]!
}

type Session {
  userID: String!
  name: String
  image: String
  repoList: [Repository!]!
}

type ServiceLogsResponse {
  logs: [LogEntry!]!
  source: String!
}

type LogEntry {
  timestamp: String
  message: String
}
```

---

## Nullability (verified)

### Confirmed Non-Nullable Fields
- `status` → `DeploymentStatus!` (defaults to `'didnt_deploy'`)
- `scan_results` → `JSON!` (can be `{}` but never null)
- `ec2.instanceId` (when `deploymentTarget === 'ec2'`)
- All Repository fields except optional ones below

### Confirmed Nullable Fields
- `description` (Repository)
- `license` (Repository)
- `latest_commit` (Repository) - can be null if repo is empty
- `commitSha` (Deployment)
- `env_vars` (Deployment)
- `deployUrl` (Deployment)
- `custom_url` (Deployment)
- `screenshot_url` (Deployment)
- `token_usage` (Deployment) - optional
- `ec2` (Deployment) - only for EC2 deployments
- `cloudRun` (Deployment) - only for Cloud Run
- `language` (Repository) - can be empty string `""`
- `framework` (DetectedService, ScanService)
- `port` (DetectedService, ScanService)

### Schema impact (verified)
All field nullability is now proven from production database schema

---

## Database vs TypeScript mismatches

### Issue 1: Field Storage Location - ALL NON-TABLE FIELDS IN JSONB
**Reality verified**: ✅ Fields like `ec2`, `scan_results`, `env_vars`, etc. are in the `data` JSONB column

**Table columns** (explicit):
- `id`, `repo_name`, `service_name`, `owner_id`, `status`, `first_deployment`, `last_deployment`, `revision`, `scan_results`

**JSONB `data` column** (everything else):
- `url`, `branch`, `commitSha`, `env_vars`, `deployUrl`, `custom_url`, `screenshot_url`, `cloudProvider`, `deploymentTarget`, `awsRegion`, `awsEc2InstanceType`, `ec2`, `cloudRun`, `token_usage`

**Mitigation in resolver**: Extract from `data` JSONB when hydrating deployment
```typescript
const deployment = await db.getDeployment(id);
return {
  ...deployment,
  ...deployment.data, // Spread JSONB fields into root
  scan_results: deployment.scan_results,
};
```

### Issue 2: Status Field - ALWAYS HAS VALUE
**Reality verified**: ✅ `status` is column with default `'running'`, fallback to `'didnt_deploy'` in code

**GraphQL Type**: Should be `DeploymentStatus!` (non-nullable)
```graphql
type Deployment {
  status: DeploymentStatus!  # Never null - defaults to didnt_deploy
}
```

### Issue 3: EC2 Field - ALWAYS EXISTS FOR EC2 DEPLOYMENTS
**Reality verified**: ✅ When `deploymentTarget === 'ec2'`, the `ec2` object always has `instanceId`

**GraphQL Type**: Keep as nullable (non-EC2 deployments won't have it)
```graphql
ec2: EC2Details  # Nullable because only for EC2 deployments
```

### Issue 4: scan_results - CAN BE EMPTY OBJECT
**Reality verified**: ✅ Valid to be `{}` (empty), never truly null

**GraphQL Type**: Use `JSON!` with fallback
```graphql
scan_results: JSON!  # Can be empty {} but not null
```

### Issue 5: timestamp vs ISO String
**Database**: `timestamptz` columns  
**Code**: Converted to ISO string before returning  
**GraphQL**: Should be `String!` not `DateTime` scalar (since we already converted)
**Reality verified**: ✅ Already ISO strings in responses

---

## Maintainer checklist

### Database schema (verified)
- [x] EC2 metadata stored in `data` JSONB, not separate columns
- [x] Status field always has value, defaults to `'didnt_deploy'`
- [x] EC2 deployments always have `instanceId`
- [x] scan_results can be empty object `{}`
- [x] Repository data stored in `user_repos.data` JSONB

### Production Testing - READY TO GO
- [ ] **Test Repository**: `https://github.com/anirudh-makuluri/chatify-next`
  - [ ] Has deployment history
  - [ ] EC2 deployment exists after deploy
  - [ ] Can verify real data structure

### During Implementation

- [ ] Setup resolver to spread `data` JSONB fields into root object
- [ ] Add defensive null checks for: `ec2`, `cloudRun`, `env_vars`, `token_usage`
- [ ] Handle empty string `language` field
- [ ] Test with actual GitHub API (chatify-next repo)
- [ ] Verify EC2 metadata extraction
- [ ] Validate response against schema

### Before Merging

- [ ] Run query with real repository (`chatify-next`)
- [ ] Deploy chatify-next to create EC2 deployment
- [ ] Run query with active EC2 deployment
- [ ] Run history query and verify pagination
- [ ] Compare old response with new response byte-for-byte
- [ ] Run all E2E tests (`npm run test:e2e`)
- [ ] Test client code - should work unchanged
- [ ] Check if any client code needs updates for new schema

---

## 🚀 Next Steps - READY FOR PHASE 1

✅ **Audit Complete & Verified Against Production**

1. **Phase 1: Setup** (30 mins)
   - [ ] Install dependencies: `graphql-yoga`, `graphql`, `graphql-type-json`
   - [ ] Create directory structure
   - [ ] Create branch: `feat/graphql-yoga-migration`

2. **Phase 2: Schema** (2-3 hours)
   - [ ] Create `src/lib/graphql/types.ts` with all GraphQL SDL
   - [ ] Reference: Use types defined above (verified)
   - [ ] Ensure all nullable fields marked as optional

3. **Phase 3: Resolvers** (3-4 hours)
   - [ ] Create context builder with NextAuth
   - [ ] Start with Query resolvers (appOverview first)
   - [ ] Handle JSONB spreading: `{ ...deployment, ...deployment.data }`
   - [ ] Add null checks for optional fields

4. **Phase 4: Integration** (1-2 hours)
   - [ ] Wire schema + resolvers into `route.ts` with Yoga
   - [ ] Test locally: `npm run dev`

5. **Phase 5: Testing** (2 hours)
   - [ ] Test with `chatify-next` repo
   - [ ] After deploying, test with EC2 deployment
   - [ ] Verify deployment history

---

## Implementation notes

### JSONB Handling
```typescript
// In resolver when fetching deployment:
const deployment = await db.getDeployment(repoName, serviceName);

// Spread JSONB fields to root level
return {
  id: deployment.id,
  repo_name: deployment.repo_name,
  service_name: deployment.service_name,
  status: deployment.status || 'didnt_deploy',  // Fallback
  scan_results: deployment.scan_results || {},   // Fallback to empty
  ...deployment.data,  // Spread all JSONB fields (url, branch, ec2, etc.)
};
```

### Nullable Field Checks
```typescript
return {
  // ...
  ec2: deployment.data?.ec2 || null,
  cloudRun: deployment.data?.cloudRun || null,
  token_usage: deployment.data?.token_usage || null,
  env_vars: deployment.data?.env_vars || null,
};
```

### All dates are ISO strings
- Use `String!` in GraphQL, not `DateTime` scalar
- Already converted before being sent

### Use JSON scalar for complex structures
- `scan_results`: Complex nested object → `JSON!`
- `env_vars`: JSON string → `String` (or `JSON` if you want to parse server-side)
- `configSnapshot`: Arbitrary object → `JSON!`

### Test with real data
- Repository: `https://github.com/anirudh-makuluri/chatify-next`
- Has deployment history already
- Can create EC2 deployment after deploy

### Client code is flexible
- Can be changed if schema changes
- Current `graphqlClient.ts` queries will work as-is
- No breaking changes anticipated
