export type repoType = {
	id: number;
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
	build_cmd: string;
	run_cmd: string;
	workdir?: string;
	use_custom_dockerfile: boolean;
	env_vars?: string;
	deployUrl?: string,
	service_name: string,
	status?: 'running' | 'paused',
	first_deployment ?: string,
	last_deployment ?: string,
	revision ?: number
}

export type DeployStep = {
	id: string,
	label: string,
	logs: string[],
	status: 'pending' | 'in_progress' | "success" | "error"
}