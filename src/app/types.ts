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
export type AWSDeploymentTarget = 'amplify' | 'elastic-beanstalk' | 'ecs' | 'ec2';
export type GCPDeploymentTarget = 'cloud-run';
export type DeploymentTarget = AWSDeploymentTarget | GCPDeploymentTarget;

export type DeployConfig = {
	id: string,
	url: string;
	branch: string;
	install_cmd?: string;
	build_cmd?: string;
	run_cmd?: string;
	workdir?: string;
	use_custom_dockerfile: boolean;
	env_vars?: string;
	deployUrl?: string,
	service_name: string,
	status?: 'running' | 'paused' | 'stopped' | 'didnt_deploy',
	first_deployment?: string,
	last_deployment?: string,
	revision?: number
	dockerfile?: File,
	dockerfileInfo?: {
		name: string,
		type: string,
		content: string,
	},
	dockerfileContent?: string
	core_deployment_info?: CoreDeploymentInfo;
	features_infrastructure?: FeaturesInfrastructure;
	final_notes?: FinalNotes;
	
	// Cloud provider configuration
	cloudProvider?: CloudProvider;
	deploymentTarget?: DeploymentTarget;
	awsRegion?: string;
}

export type DeployStep = {
	id: string,
	label: string,
	logs: string[],
	status: 'pending' | 'in_progress' | "success" | "error"
}


type CoreDeploymentInfo = {
	language: string;
	framework: string;
	install_cmd: string;
	build_cmd: string | null;
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

export type AIGenProjectMetadata = {
	core_deployment_info: CoreDeploymentInfo;
	features_infrastructure: FeaturesInfrastructure;
	final_notes: FinalNotes;
};