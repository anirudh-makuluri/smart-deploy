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
	status?: 'running' | 'paused' | 'stopped',
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
	workdir: string;
	port?: number;
};

type FeaturesInfrastructure = {
	uses_websockets: boolean;
	uses_database: boolean;
	database_type?: string;
	uses_redis: boolean;
	uses_file_uploads: boolean;
	uses_cron: boolean;
	uses_docker: boolean;
};

type FrontendBuild = {
	uses_typescript: boolean;
	uses_tailwind: boolean;
	static_site: boolean;
	ssr_enabled: boolean;
	build_tool: "Webpack" | "Vite" | "Rollup" | string;
};

type QualityTooling = {
	uses_testing: boolean;
	testing_frameworks: string[];
	uses_logging: boolean;
	logging_libs: string[];
	has_docs: boolean;
	has_readme: boolean;
};

type FinalNotes = {
	comment: string;
};

export type AIGenProjectMetadata = {
	core_deployment_info: CoreDeploymentInfo;
	features_infrastructure: FeaturesInfrastructure;
	frontend_build: FrontendBuild;
	quality_tooling: QualityTooling;
	final_notes: FinalNotes;
};
