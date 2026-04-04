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
export type DeploymentTarget = 'ec2' | 'cloud_run';

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
	status: 'running' | 'paused' | 'stopped' | 'didnt_deploy' | 'failed';
	/** ISO timestamp when first deployed; null if never deployed */
	firstDeployment: string | null;
	/** ISO timestamp of most recent deployment; null if never deployed */
	lastDeployment: string | null;
	/** Deployment revision counter; increments after each successful deploy */
	revision: number;
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
	scanResults: SDArtifactsResponse | {};
}

export type DeployStep = {
	id: string,
	label: string,
	logs: string[],
	status: 'pending' | 'in_progress' | "success" | "error",
	/** When this step first received a log (ISO string) */
	startedAt?: string,
	/** When this step completed — success or error (ISO string) */
	endedAt?: string,
}












/** Service info detected via GraphQL detectServices and persisted in repo_services. */
export type DetectedServiceInfo = {
	name: string;
	path: string;
	language: string;
	framework?: string;
	port?: number | null;
};

/** Stored record per user+repo for detected services metadata. */
export type RepoServicesRecord = {
	repo_url: string;
	branch: string;
	repo_owner: string;
	repo_name: string;
	services: DetectedServiceInfo[];
	is_monorepo: boolean;
	updatedAt: string;
};

/** Per-platform compatibility from LLM: true if the project can run on that platform. */
export type ServiceCompatibility = {
	ec2?: boolean;
	cloud_run?: boolean;
};


/** One deployment attempt: success or failure, with logs for history and "Why did it fail?". */
export type DeploymentHistoryEntry = {
	id: string;
	/** Repository name (e.g. "my-app") — together with service_name identifies the deployment. */
	repo_name: string;
	/** Service name (e.g. "api" or "." for repo-level). */
	service_name: string;
	timestamp: string;
	success: boolean;
	/** Step-by-step deploy logs. */
	steps: DeployStep[];
	/** Snapshot of config used (no File/binary). */
	configSnapshot: Record<string, unknown>;
	/** Commit SHA that was deployed */
	commitSha?: string;
	/** Commit message */
	commitMessage?: string;
	/** Branch that was deployed */
	branch?: string;
	/** Deployment duration in milliseconds */
	durationMs?: number;
};

export type SDArtifactsResponse = {
	commit_sha?: string;
	stack_summary: string;
	services: {
		name: string;
		build_context: string;
		port: number;
		dockerfile_path: string;
		language?: string;
		framework?: string;
	}[];
	dockerfiles: Record<string, string>;
	docker_compose: string;
	nginx_conf: string;
	has_existing_dockerfiles: boolean;
	has_existing_compose: boolean;
	risks: string[];
	confidence: number;
	hadolint_results: Record<string, string>;
	token_usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
};
