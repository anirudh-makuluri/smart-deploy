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
export type AWSDeploymentTarget = 'amplify' | 'elastic-beanstalk' | 'ecs' | 'ec2' | 'cloud-run';
export type GCPDeploymentTarget = 'cloud-run';
export type DeploymentTarget = AWSDeploymentTarget | GCPDeploymentTarget;

// ── Per-service deployment details (stored after deploy; reused on redeploy) ──

export type EC2DeployDetails = {
	baseUrl: string;
	instanceId: string;
	publicIp: string;
	vpcId: string;
	subnetId: string;
	securityGroupId: string;
	amiId: string;
};

export type ECSDeployDetails = {
	clusterName: string;
	clusterArn: string;
	/** ECS service names (e.g. ["my-app-svc"]) */
	serviceNames: string[];
	vpcId: string;
	subnetIds: string[];
	securityGroupId: string;
};

export type AmplifyDeployDetails = {
	appId: string;
	appName: string;
	branchName: string;
};

export type ElasticBeanstalkDeployDetails = {
	appName: string;
	envName: string;
	s3Bucket: string;
};

export type CloudRunDeployDetails = {
	// Expand with service name, region, etc. when needed
};

// ── Main deployment config ──

export type DeployConfig = {
	id: string;
	url: string;
	branch: string;
	/** Optional commit SHA to deploy a specific commit instead of branch HEAD */
	commitSha?: string;
	use_custom_dockerfile: boolean;
	env_vars?: string;
	deployUrl?: string;
	/** Custom URL (e.g. https://myapp.anirudh-makuluri.xyz) when NEXT_PUBLIC_DEPLOYMENT_DOMAIN is used. */
	custom_url?: string;
	service_name: string;
	status?: 'running' | 'paused' | 'stopped' | 'didnt_deploy';
	first_deployment?: string;
	last_deployment?: string;
	revision?: number;
	dockerfile?: File;
	dockerfileInfo?: {
		name: string;
		type: string;
		content: string;
	};
	dockerfileContent?: string;
	core_deployment_info?: CoreDeploymentInfo;
	features_infrastructure?: FeaturesInfrastructure;
	final_notes?: FinalNotes;

	// Cloud provider configuration
	cloudProvider?: CloudProvider;
	deploymentTarget?: DeploymentTarget;
	deployment_target_reason?: string;
	awsRegion?: string;

	// Per-service deployment details (populated after deploy, persisted for redeploy)
	ec2?: EC2DeployDetails;
	ecs?: ECSDeployDetails;
	amplify?: AmplifyDeployDetails;
	elasticBeanstalk?: ElasticBeanstalkDeployDetails;
	cloudRun?: CloudRunDeployDetails;
}

export type DeployStep = {
	id: string,
	label: string,
	logs: string[],
	status: 'pending' | 'in_progress' | "success" | "error"
}


export type CoreDeploymentInfo = {
	language: string;
	framework: string;
	install_cmd: string;
	build_cmd: string;
	run_cmd: string;
	workdir: string | null;
	port?: number;
};

type FeaturesInfrastructure = {
	uses_websockets: boolean;
	uses_cron: boolean;
	uses_mobile: boolean;
	uses_server?: boolean;
	cloud_run_compatible: boolean;
	is_library: boolean;
	requires_build_but_missing_cmd: boolean;
};

type FinalNotes = {
	comment: string;
};

/** Hints from scan (LLM) used to derive deployment target without filesystem. */
export type DeploymentHints = {
	has_dockerfile?: boolean;
	is_multi_service?: boolean;
	has_database?: boolean;
	nextjs_static_export?: boolean;
};

/** Per-platform compatibility from LLM: true if the project can run on that platform. */
export type ServiceCompatibility = {
	amplify?: boolean;
	elastic_beanstalk?: boolean;
	ecs?: boolean;
	ec2?: boolean;
	cloud_run?: boolean;
};

export type AIGenProjectMetadata = {
	core_deployment_info: CoreDeploymentInfo;
	features_infrastructure: FeaturesInfrastructure;
	deployment_hints?: DeploymentHints;
	/** LLM-reported compatibility per platform; used to pick simplest compatible target. */
	service_compatibility?: ServiceCompatibility;
	final_notes: FinalNotes;
};

/** One deployment attempt: success or failure, with logs for history and "Why did it fail?". */
export type DeploymentHistoryEntry = {
	id: string;
	deploymentId: string;
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