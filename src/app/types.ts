export type repoType = {
	id: string;
	name: string;
	full_name: string;
	html_url: string;
	language: string;
	languages_url: string;
	created_at: string;
	updated_at: string;
	pushed_at: string;
	default_branch: string;
	private: boolean;
	description: string | null;
	visibility: 'public' | 'private' | 'internal';
	license: {
		spdx_id: string;
	} | null;

	forks_count: number;
	watchers_count: number;
	open_issues_count: number;
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
export type DeploymentTarget = 'ec2' | 'cloud-run';

// ── Per-service deployment details (stored after deploy; reused on redeploy) ──

export type EC2DeployDetails = {
	success: boolean;
	baseUrl: string;
	instanceId: string;
	publicIp: string;
	vpcId: string;
	subnetId: string;
	securityGroupId: string;
	amiId: string;
};

export type CloudRunDeployDetails = {
	// Expand with service name, region, etc. when needed
};

// ── Main deployment config ──

export type DeployConfig = {
	id: string;
	repo_name: string;
	url: string;
	branch: string;
	commitSha?: string;
	env_vars?: string;
	deployUrl?: string;
	custom_url?: string;
	service_name: string;
	status?: 'running' | 'paused' | 'stopped' | 'didnt_deploy' | 'failed';
	first_deployment?: string;
	last_deployment?: string;
	revision?: number;
	token_usage?: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
	};
	cloudProvider?: CloudProvider;
	deploymentTarget?: DeploymentTarget;
	awsRegion?: string;
	/** EC2 instance type for new instances (e.g. t3.small). Defaults to t3.micro. */
	awsEc2InstanceType?: string;
	ec2?: EC2DeployDetails;
	cloudRun?: CloudRunDeployDetails;
	scan_results?: SDArtifactsResponse;
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












/** Service info detected by /api/repos/detect-services and persisted in repo_services. */
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
