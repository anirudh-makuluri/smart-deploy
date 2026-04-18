/**
 * GraphQL Type Definitions (SDL)
 * 
 * Maps TypeScript types to GraphQL schema.
 * Field nullability verified against production database.
 */

export const typeDefs = `
  scalar JSON
  
  # ──────────────────────────────────────────────────────────────
  # Repository / GitHub Types
  # ──────────────────────────────────────────────────────────────

  enum RepositoryVisibility {
    public
    private
    internal
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

  type RepositoryOwner {
    login: String!
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
    visibility: RepositoryVisibility!
    owner: RepositoryOwner!
    latest_commit: Commit
    branches: [Branch!]!
  }

  # ──────────────────────────────────────────────────────────────
  # Deployment Types
  # ──────────────────────────────────────────────────────────────

  enum DeploymentStatus {
    running
	paused
	stopped
	didnt_deploy
	failed
  }

  enum CloudProvider {
    aws
    gcp
  }

  enum DeploymentTarget {
    ec2
    cloud_run
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
    sharedAlbDns: String!
    instanceType: String!
  }

  type CloudRunDetails {
    serviceId: String!
    region: String!
    projectId: String!
  }

  type Deployment {
    id: String!
    repoName: String!
    url: String!
    branch: String!
    commitSha: String
    envVars: String
    liveUrl: String
    screenshotUrl: String
    serviceName: String!
    status: DeploymentStatus!
    firstDeployment: String
    lastDeployment: String
    revision: Int
    cloudProvider: CloudProvider
    deploymentTarget: DeploymentTarget
    awsRegion: String
    ec2: EC2Details
    cloudRun: CloudRunDetails
    scanResults: JSON!
  }

  # ──────────────────────────────────────────────────────────────
  # Service Detection Types
  # ──────────────────────────────────────────────────────────────

  type DetectedService {
    name: String!
    path: String!
    language: String!
    framework: String
    port: Int
  }

  type RepoServices {
    repo_url: String!
    branch: String!
    repo_owner: String!
    repo_name: String!
    services: [DetectedService!]!
    is_monorepo: Boolean!
    updated_at: String!
  }

  # ──────────────────────────────────────────────────────────────
  # Scan Results / Infrastructure Types
  # ──────────────────────────────────────────────────────────────

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

  # ──────────────────────────────────────────────────────────────
  # Deployment History Types
  # ──────────────────────────────────────────────────────────────

  enum DeployStepStatus {
    pending
    in_progress
    success
    error
  }

  type DeployStep {
    id: String!
    label: String!
    logs: [String!]!
    status: DeployStepStatus!
    startedAt: String
    endedAt: String
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

  type DeploymentHistoryPage {
    history: [DeploymentHistoryEntry!]!
    page: Int!
    limit: Int!
    total: Int!
  }

  # ──────────────────────────────────────────────────────────────
  # Session & User Types
  # ──────────────────────────────────────────────────────────────

  type Session {
    userID: String!
    name: String
    image: String
    repoList: [Repository!]!
  }

  # ──────────────────────────────────────────────────────────────
  # Response Types
  # ──────────────────────────────────────────────────────────────

  type AppOverviewResult {
    repoList: [Repository!]!
    deployments: [Deployment!]!
    repoServices: [RepoServices!]!
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

  type LogEntry {
    timestamp: String
    message: String
  }

  type ServiceLogsResponse {
    logs: [LogEntry!]!
    source: String!
  }

  # ──────────────────────────────────────────────────────────────
  # Mutation Input Types
  # ──────────────────────────────────────────────────────────────

  input DeployConfigInput {
    id: String
    repoName: String!
    url: String
    branch: String
    commitSha: String
    envVars: String
    liveUrl: String
    screenshotUrl: String
    serviceName: String!
    status: DeploymentStatus
    firstDeployment: String
    lastDeployment: String
    revision: Int
    cloudProvider: CloudProvider
    deploymentTarget: DeploymentTarget
    awsRegion: String
    ec2: JSON
    cloudRun: JSON
    scanResults: JSON
  }

  input DeleteDeploymentInput {
    repoName: String!
    serviceName: String!
  }

  input DeploymentControlInput {
    repoName: String!
    serviceName: String!
    action: String!
  }

  # ──────────────────────────────────────────────────────────────
  # Root Query Type
  # ──────────────────────────────────────────────────────────────

  type Query {
    # Overview of all repos, deployments, and services for authenticated user
    appOverview: AppOverviewResult!

    # Deployments for a specific repo
    repoDeployments(repoName: String!): [Deployment!]!

    # Detected services for all user repos
    repoServices: [RepoServices!]!

    # Resolve a repo by owner and name
    resolveRepo(owner: String!, repo: String!): Repository

    # Latest commit on a branch
    latestCommit(owner: String!, repo: String!, branch: String): Commit

    # Deployment history for a specific service
    deploymentHistory(
      repoName: String!
      serviceName: String!
      page: Int
      limit: Int
    ): DeploymentHistoryPage!

    # All deployment history for authenticated user
    deploymentHistoryAll(page: Int, limit: Int): DeploymentHistoryPage!

    # Current session info with repos
    session(limit: Int): Session!

    # Service logs (EC2 or GCP)
    serviceLogs(
      repoName: String
      serviceName: String!
      limit: Int
    ): ServiceLogsResponse!
  }

  # ──────────────────────────────────────────────────────────────
  # Root Mutation Type
  # ──────────────────────────────────────────────────────────────

  type Mutation {
    # Update deployment config
    updateDeployment(config: DeployConfigInput!): ControlResult!

    # Delete a deployment
    deleteDeployment(payload: DeleteDeploymentInput!): DeleteResult!

    # Control deployment (pause/resume/stop)
    deploymentControl(input: DeploymentControlInput!): ControlResult!

    # Detect services in a repository
    detectServices(url: String!, branch: String): DetectServicesResult!

    # Add one service by repo-relative root directory
    addRepoServiceRoot(
      url: String!
      branch: String
      rootPath: String!
      displayName: String
    ): DetectServicesResult!

    # Remove a service from the stored catalog by service name
    removeRepoService(url: String!, serviceName: String!): DetectServicesResult!

    # Add a public repository
    addPublicRepo(owner: String!, repo: String!): Repository

    # Update custom domain for deployment
    updateCustomDomain(
      repoName: String!
      serviceName: String!
      customUrl: String
    ): UpdateCustomDomainResult!

    # Verify DNS subdomain availability
    verifyDns(
      subdomain: String!
      repoName: String
      serviceName: String
    ): VerifyDnsResult!

    # Clone a repository
    cloneRepo(repoUrl: String!, repoName: String!): CloneResult!

    # Prefill infrastructure detection
    prefillInfra(
      url: String!
      branch: String
      packagePath: String
    ): PrefillResult!

    # Refresh repos from GitHub
    refreshRepos: RefreshResult!
  }
`;
