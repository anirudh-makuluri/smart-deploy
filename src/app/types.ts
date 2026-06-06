import type { DeploymentStatus } from "@/lib/deploymentStatus";

export type repoType = {
	id: string;
	name: string;
	full_name: string;
	html_url: string;
	language: string | null;
	languages_url: string;
	created_at: string;
	updated_at: string;
	pushed_at: string;
	default_branch: string;
	private: boolean;
	visibility: 'public' | 'private' | 'internal';
	owner: {
		login: string;
	};

	latest_commit: {
		message: string;
		author: string;
		date: string;
		sha: string;
		url: string;
	} | null;

	branches: {
		name: string;
		commit_sha: string;
		protected: boolean;
	}[];
};


// Cloud provider types
export type CloudProvider = 'aws' | 'gcp';
export type DeploymentTarget = "ec2" | "ecs" | "cloud_run" | "static_s3";
export type DeploymentKind = "container";
export type StaticServiceType =
	| 'vite'
	| 'cra'
	| 'vue'
	| 'angular'
	| 'svelte'
	| 'astro'
	| 'next-export'
	| 'static-html';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

// ── Per-service deployment details (stored after deploy; reused on redeploy) ──

export type EC2Details = {
	success: boolean;
	baseUrl: string;
	instanceId: string;
	publicIp: string;
	vpcId: string;
	subnetId: string;
	securityGroupId: string;
	amiId: string;
	sharedAlbDns: string;
	instanceType: string;
};

export type CloudRunDetails = {
	serviceId: string;
	region: string;
	projectId: string;
};

// ── Main deployment config ──

export type DeployConfig = {
	id: string;
	repoName: string;
	url: string;
	branch: string;
	kind?: DeploymentKind;
	/** Linked analysis_responses.id for the latest scan payload */
	responseId?: string | null;
	/** Commit SHA that was deployed; null if never deployed */
	commitSha: string | null;
	/** Environment variables as JSON string (optional for deployment) */
	envVars: string | null;
	/** Live deployment URL (either auto-deployed or custom); null if didnt_deploy */
	liveUrl: string | null;
	/** Public URL to a screenshot of the deployed app (stored in Supabase Storage); null if didnt_deploy */
	screenshotUrl: string | null;
	serviceName: string;
	/** Deployment status */
	status: DeploymentStatus;
	/** ISO timestamp when first deployed; null if never deployed */
	firstDeployment: string | null;
	/** ISO timestamp of most recent deployment; null if never deployed */
	lastDeployment: string | null;
	/** Deployment revision counter; increments after each successful deploy */
	revision: number | null;
	/** Cloud provider (defaults to 'aws') */
	cloudProvider: CloudProvider;
	/** Deployment target (defaults to 'ec2' for AWS) */
	deploymentTarget: DeploymentTarget;
	/** AWS region (defaults to value from config) */
	awsRegion: string;
	/** AWS EC2 deployment details (null if not deployed to EC2 or status === didnt_deploy) */
	ec2: EC2Details | null;
	/** Google Cloud Run deployment details (null if not deployed to Cloud Run or status === didnt_deploy) */
	cloudRun: CloudRunDetails | null;
	/** Analysis/scan results from detectServices */
	scanResults: ScanResultsPayload;
}

export type EcrServiceImageRef = {
	serviceName: string;
	ecrRepoName: string;
	imageUri: string;
	imageDigest?: string | null;
};

export type EcrImageReleaseArtifact = {
	kind: "ecr_image";
	cloudProvider: "aws";
	deploymentTarget: "ecs";
	region: string;
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	imageUri: string;
	imageDigest?: string | null;
	serviceImages?: EcrServiceImageRef[];
	branch?: string | null;
	commitSha?: string | null;
	deployConfig: Record<string, unknown>;
};

export type Ec2ConfigReleaseArtifact = {
	kind: "ec2_config";
	cloudProvider: "aws";
	deploymentTarget: "ec2";
	branch?: string | null;
	commitSha?: string | null;
	deployConfig: Record<string, unknown>;
};

export type StaticSiteReleaseArtifact = {
	kind: "static_site";
	cloudProvider: "aws";
	deploymentTarget: "static_s3";
	region: string;
	bucket: string;
	keyPrefix: string;
	publicBaseUrl: string;
	cloudFrontDistributionId?: string | null;
	branch?: string | null;
	commitSha?: string | null;
	deployConfig: Record<string, unknown>;
};

export type DeploymentReleaseArtifact =
	| EcrImageReleaseArtifact
	| Ec2ConfigReleaseArtifact
	| StaticSiteReleaseArtifact;

export type DeploymentFailureStage =
	| "clone"
	| "detect"
	| "auth"
	| "database"
	| "build"
	| "setup"
	| "deploy"
	| "verify"
	| "rollback"
	| "done"
	| "unknown";

export type DeploymentFailureCategory =
	| "auth_failure"
	| "build_failure"
	| "startup_failure"
	| "health_check_failure"
	| "rollback_failure"
	| "infrastructure_failure"
	| "unknown_failure";

export type DeploymentFailureCode =
	| "AUTHENTICATION_FAILED"
	| "CODEBUILD_DOCKER_IMAGE_BUILD_FAILED"
	| "EC2_CLOUD_INIT_FAILURE"
	| "EC2_CLOUD_INIT_NO_COMPLETION_SIGNAL"
	| "EC2_SERVER_NOT_RESPONDING"
	| "DEPLOYMENT_VERIFICATION_FAILED"
	| "AUTOMATIC_ROLLBACK_FAILED"
	| "AUTOMATIC_ROLLBACK_NO_CANDIDATE"
	| "MANUAL_ROLLBACK_FAILED"
	| "INFRASTRUCTURE_NETWORK_FAILURE"
	| "DEPLOYMENT_FAILED_GENERIC";

export type DeploymentFailureClassification = {
	stage: DeploymentFailureStage;
	category: DeploymentFailureCategory;
	retryable: boolean;
	summary: string;
	likelyCause: string;
	evidence: string[];
	failedStep?: string | null;
	autoRollbackTriggered?: boolean;
};

export type DeployStep = {
	id: string,
	label: string,
	logs: string[],
	status: 'pending' | 'in_progress' | "success" | "error",
	/** When this step first received a log (ISO string) */
	startedAt?: string,
	/** When this step completed: success or error (ISO string) */
	endedAt?: string,
}












/** Service info detected via GraphQL detectServices and persisted in repo_services. */
export type DetectedServiceInfo = {
	name: string;
	path: string;
	language: string;
	framework?: string;
	port?: number | null;
	deployMode: DeploymentKind;
	serviceType?: StaticServiceType;
};

/** Stored record per user+repo for detected services metadata. */
export type RepoServicesRecord = {
	repo_url: string;
	branch: string;
	repo_owner: string;
	repo_name: string;
	services: DetectedServiceInfo[];
	is_monorepo: boolean;
	updated_at: string;
};

/** Per-platform compatibility from LLM: true if the project can run on that platform. */
export type ServiceCompatibility = {
	ec2?: boolean;
	cloud_run?: boolean;
};


/** One deployment attempt: success or failure, with logs for history and "Why did it fail?". */
export type DeploymentHistoryEntry = {
	id: string;
	/** Repository name (e.g. "my-app"); together with service_name identifies the deployment. */
	repo_name: string;
	/** Service name (e.g. "api" or "." for repo-level). */
	service_name: string;
	timestamp: string;
	success: boolean;
	/** Step-by-step deploy logs. */
	steps: DeployStep[];
	/** Snapshot of config used (no File/binary). */
	configSnapshot: Record<string, unknown>;
	/** Immutable release artifact/config used by rollback. */
	releaseArtifact?: DeploymentReleaseArtifact | Record<string, unknown>;
	/** Commit SHA that was deployed */
	commitSha?: string;
	/** Commit message */
	commitMessage?: string;
	/** Branch that was deployed */
	branch?: string;
	/** Deployment duration in milliseconds */
	durationMs?: number;
	/** Stable failure code for failed deployments */
	failureCode?: DeploymentFailureCode | null;
	/** Structured failure metadata derived from logs and lifecycle state */
	failureClassification?: DeploymentFailureClassification | null;
};

/** sd-artifacts `AnalyzeResponse` fields. See `sd-artifacts-integration.md` §4. */
export type SDAnalyzeBuildStatus =
	| "passed"
	| "failed"
	| "partial"
	| "skipped"
	| "error"
	| "not_run";

export type SDDeployShape =
	| "static"
	| "static_build"
	| "server"
	| "multi"
	| "existing_docker";

export type SDRailpackPlan = {
	steps?: Array<{ name: string; commands?: Array<{ cmd: string }> }>;
	deploy?: {
		startCommand?: string;
		variables?: Record<string, string>;
	};
};

export type SDDeployUnit = {
	name: string;
	root: string;
	type: string;
	provider: string;
	framework: string | null;
	port: number;
	artifacts: {
		railpack_plan: SDRailpackPlan | null;
		railpack_json: Record<string, unknown> | null;
	};
};

export type SDBuildVerification = {
	backend?: string;
	status?: string;
	message?: string;
	attempts?: number;
	duration_seconds?: number;
	log_excerpt?: string;
};

export type SDRepairAttempt = {
	attempt?: number;
	unit_name?: string;
	diagnosis?: string;
	patch?: Record<string, unknown>;
	railpack_json_after_merge?: Record<string, unknown> | null;
	build_log_excerpt?: string;
	build_exit_code?: number | null;
	duration_seconds?: number;
	result?: string;
};

/** sd-artifacts `AnalyzeResponse` (§4). */
export type SDArtifactsResponse = {
	response_id: string;
	commit_sha: string;
	package_path: string;
	deploy_shape: SDDeployShape;
	build_status: SDAnalyzeBuildStatus;
	railpack_version: string | null;
	workflow_version: string | null;
	deploy_briefing: string;
	deploy_units: SDDeployUnit[];
	build_verification: SDBuildVerification;
	repair_history: SDRepairAttempt[];
	pipeline_trace: Array<Record<string, unknown>>;
	errors: string[];
	llm_outputs: Record<string, unknown>;
	inputs_snapshot: Record<string, unknown>;
	token_usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
};

export type ScanResultsPayload = SDArtifactsResponse | Record<string, never>;
