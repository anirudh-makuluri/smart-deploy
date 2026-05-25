import type {
	DeployConfig,
	DeploymentHistoryEntry,
	DeploymentRemediationAttempt,
	DetectedServiceInfo,
	RepoServicesRecord,
	SDArtifactsResponse,
	repoType,
} from "@/app/types";

type GraphQLResponse<T> = {
	data?: T;
	errors?: { message: string }[];
};

type BenchmarkSample = {
	label: "graphql" | "rest";
	durationMs: number;
	responseSizeBytes: number;
};

export type AppOverviewBenchmarkResult = {
	graphql: BenchmarkSample[];
	graphqlAverageMs: number;
};

async function graphQLRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
	const res = await fetch("/api/graphql", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query, variables }),
	});
	const payload: GraphQLResponse<T> = await res.json();
	if (payload.errors && payload.errors.length > 0) {
		throw new Error(payload.errors[0].message);
	}
	if (!res.ok) {
		throw new Error("GraphQL request failed");
	}
	if (payload.data === undefined) {
		throw new Error("GraphQL response missing data");
	}
	return payload.data;
}

function average(samples: BenchmarkSample[]) {
	if (samples.length === 0) return 0;
	return Math.round(samples.reduce((sum, sample) => sum + sample.durationMs, 0) / samples.length);
}

function getResponseSize(payload: unknown) {
	return new TextEncoder().encode(JSON.stringify(payload)).length;
}

const APP_OVERVIEW_QUERY = `
	query AppOverview {
		appOverview {
			repoList {
				id
				name
				full_name
				html_url
				language
				languages_url
				created_at
				updated_at
				pushed_at
				default_branch
				private
				visibility
				owner {
					login
				}
				latest_commit {
					message
					author
					date
					sha
					url
				}
				branches {
					name
					commit_sha
					protected
				}
			}
			deployments {
				id
				repoName
				url
				branch
				responseId
				commitSha
				envVars
				liveUrl
				screenshotUrl
				serviceName
				status
				lifecycleState
				firstDeployment
				lastDeployment
				revision
				cloudProvider
				deploymentTarget
				awsRegion
				autoFixEnabled
				maxAutoFixRetries
				healthMonitoringWindowSec
				latestHealthStatus
				latestHealthCheckAt
				ec2 {
					success
					baseUrl
					instanceId
					publicIp
					vpcId
					subnetId
					securityGroupId
					amiId
					sharedAlbDns
					instanceType
				}
				cloudRun {
					serviceId
					region
					projectId
				}
				scanResults
			}
			repoServices {
				repo_url
				branch
				repo_owner
				repo_name
				is_monorepo
				updated_at
				services {
					name
					path
					language
					framework
					port
				}
			}
		}
	}
`;

const REPO_DEPLOYMENTS_QUERY = `
	query RepoDeployments($repoName: String!) {
		repoDeployments(repoName: $repoName) {
			id
			repoName
			url
			branch
			responseId
			commitSha
			envVars
			liveUrl
			screenshotUrl
			serviceName
			status
			lifecycleState
			firstDeployment
			lastDeployment
			revision
			cloudProvider
			deploymentTarget
			awsRegion
			autoFixEnabled
			maxAutoFixRetries
			healthMonitoringWindowSec
			latestHealthStatus
			latestHealthCheckAt
			ec2 {
				success
				baseUrl
				instanceId
				publicIp
				vpcId
				subnetId
				securityGroupId
				amiId
				sharedAlbDns
				instanceType
			}
			cloudRun {
				serviceId
				region
				projectId
			}
			scanResults
		}
	}
`;

const REPO_SERVICES_QUERY = `
	query RepoServices {
		repoServices {
			repo_url
			branch
			repo_owner
			repo_name
			is_monorepo
			updated_at
			services {
				name
				path
				language
				framework
				port
			}
		}
	}
`;

const UPDATE_DEPLOYMENT_MUTATION = `
	mutation UpdateDeployment($config: DeployConfigInput!) {
		updateDeployment(config: $config) {
			status
		}
	}
`;

const REFRESH_REPOS_MUTATION = `
	mutation RefreshRepos {
		refreshRepos {
			status
			message
			repoList {
				id
				name
				full_name
				html_url
				language
				languages_url
				created_at
				updated_at
				pushed_at
				default_branch
				private
				visibility
				owner {
					login
				}
				latest_commit {
					message
					author
					date
					sha
					url
				}
				branches {
					name
					commit_sha
					protected
				}
			}
		}
	}
`;

export type AppOverviewData = {
	repoList: repoType[];
	deployments: DeployConfig[];
	repoServices: RepoServicesRecord[];
};

export type DeploymentHistoryPage = {
	history: DeploymentHistoryEntry[];
	page: number;
	limit: number;
	total: number;
};

export async function fetchAppOverview(): Promise<AppOverviewData> {
	const data = await graphQLRequest<{ appOverview: AppOverviewData }>(APP_OVERVIEW_QUERY);
	return data.appOverview;
}

export async function benchmarkAppOverview(runs = 5): Promise<AppOverviewBenchmarkResult> {
	const graphql: BenchmarkSample[] = [];

	for (let index = 0; index < runs; index += 1) {
		const graphqlStart = performance.now();
		const graphqlResult = await fetchAppOverview();
		graphql.push({
			label: "graphql",
			durationMs: Math.round(performance.now() - graphqlStart),
			responseSizeBytes: getResponseSize(graphqlResult),
		});

	}

	const result = {
		graphql,
		graphqlAverageMs: average(graphql),
	};

	console.table({
		graphql: {
			averageMs: result.graphqlAverageMs,
			lastResponseBytes: graphql.at(-1)?.responseSizeBytes ?? 0,
			runs: graphql.length,
		},
	});

	return result;
}

export async function fetchRepoDeployments(repoName: string): Promise<DeployConfig[]> {
	const data = await graphQLRequest<{ repoDeployments: DeployConfig[] }>(REPO_DEPLOYMENTS_QUERY, { repoName });
	return data.repoDeployments;
}

export async function fetchRepoServices(): Promise<RepoServicesRecord[]> {
	const data = await graphQLRequest<{ repoServices: RepoServicesRecord[] }>(REPO_SERVICES_QUERY);
	return data.repoServices;
}

export async function updateDeployment(config: DeployConfig): Promise<void> {
	await graphQLRequest(UPDATE_DEPLOYMENT_MUTATION, { config });
}

export async function refreshRepos(): Promise<repoType[]> {
	const data = await graphQLRequest<{ refreshRepos: { repoList: repoType[] } }>(REFRESH_REPOS_MUTATION);
	return data.refreshRepos.repoList;
}

const DEPLOYMENT_HISTORY_QUERY = `
	query DeploymentHistory($repoName: String!, $serviceName: String!, $page: Int!, $limit: Int!) {
		deploymentHistory(repoName: $repoName, serviceName: $serviceName, page: $page, limit: $limit) {
			history {
				id
				repo_name
				service_name
				timestamp
				success
				commitSha
				commitMessage
				branch
				durationMs
				steps {
					label
					logs
					status
					startedAt
					endedAt
				}
				configSnapshot
				remediationAttempts {
					id
					attempt_number
					trigger_type
					health_failure_type
					summary
					root_cause
					evidence
					risk_level
					confidence
					diff_preview
					files_to_modify
					expected_outcome
					can_auto_apply
					approved_by_user
					applied
					success
					status
					error
					created_at
					updated_at
					changes {
						title
						description
						target
					}
				}
				healthChecks {
					id
					url
					status
					http_status
					failure_type
					latency_ms
					error_message
					checked_at
				}
			}
			page
			limit
			total
		}
	}
`;

const DEPLOYMENT_HISTORY_ALL_QUERY = `
	query DeploymentHistoryAll($page: Int!, $limit: Int!) {
		deploymentHistoryAll(page: $page, limit: $limit) {
			history {
				id
				repo_name
				service_name
				timestamp
				success
				commitSha
				commitMessage
				branch
				durationMs
				steps {
					label
					logs
					status
					startedAt
					endedAt
				}
				configSnapshot
				remediationAttempts {
					id
					attempt_number
					trigger_type
					health_failure_type
					summary
					root_cause
					evidence
					risk_level
					confidence
					diff_preview
					files_to_modify
					expected_outcome
					can_auto_apply
					approved_by_user
					applied
					success
					status
					error
					created_at
					updated_at
					changes {
						title
						description
						target
					}
				}
				healthChecks {
					id
					url
					status
					http_status
					failure_type
					latency_ms
					error_message
					checked_at
				}
			}
			page
			limit
			total
		}
	}
`;

const DEPLOYMENT_REMEDIATION_ATTEMPT_FIELDS = `
	id
	repo_name
	service_name
	deployment_history_id
	attempt_number
	trigger_type
	health_failure_type
	summary
	root_cause
	evidence
	risk_level
	confidence
	diff_preview
	files_to_modify
	expected_outcome
	can_auto_apply
	approved_by_user
	applied
	success
	status
	error
	created_at
	updated_at
	changes {
		title
		description
		target
	}
`;

export async function fetchDeploymentHistoryPage(repoName: string, serviceName: string, page = 1, limit = 10): Promise<DeploymentHistoryPage> {
	const data = await graphQLRequest<{ deploymentHistory: DeploymentHistoryPage }>(
		DEPLOYMENT_HISTORY_QUERY,
		{ repoName, serviceName, page, limit }
	);
	return data.deploymentHistory;
}

export async function fetchDeploymentHistoryAllPage(page = 1, limit = 10): Promise<DeploymentHistoryPage> {
	const data = await graphQLRequest<{ deploymentHistoryAll: DeploymentHistoryPage }>(
		DEPLOYMENT_HISTORY_ALL_QUERY,
		{ page, limit }
	);
	return data.deploymentHistoryAll;
}

export async function fetchDeploymentRemediationAttempt(attemptId: string): Promise<DeploymentRemediationAttempt | null> {
	const data = await graphQLRequest<{ deploymentRemediationAttempt: DeploymentRemediationAttempt | null }>(
		DEPLOYMENT_REMEDIATION_ATTEMPT_QUERY,
		{ attemptId }
	);
	return data.deploymentRemediationAttempt ?? null;
}

export async function fetchDeploymentRemediationDiff(attemptId: string): Promise<Record<string, unknown>[] | string[]> {
	const data = await graphQLRequest<{ deploymentRemediationDiff: Record<string, unknown>[] | string[] }>(
		DEPLOYMENT_REMEDIATION_DIFF_QUERY,
		{ attemptId }
	);
	return data.deploymentRemediationDiff ?? [];
}

export async function approveDeploymentRemediation(attemptId: string): Promise<DeploymentRemediationAttempt> {
	const data = await graphQLRequest<{ approveDeploymentRemediation: DeploymentRemediationAttempt }>(
		APPROVE_DEPLOYMENT_REMEDIATION_MUTATION,
		{ attemptId }
	);
	return data.approveDeploymentRemediation;
}

export async function rejectDeploymentRemediation(attemptId: string): Promise<DeploymentRemediationAttempt> {
	const data = await graphQLRequest<{ rejectDeploymentRemediation: DeploymentRemediationAttempt }>(
		REJECT_DEPLOYMENT_REMEDIATION_MUTATION,
		{ attemptId }
	);
	return data.rejectDeploymentRemediation;
}

const DEPLOYMENT_REMEDIATION_ATTEMPT_QUERY = `
	query DeploymentRemediationAttempt($attemptId: String!) {
		deploymentRemediationAttempt(attemptId: $attemptId) {
			${DEPLOYMENT_REMEDIATION_ATTEMPT_FIELDS}
		}
	}
`;

const DEPLOYMENT_REMEDIATION_DIFF_QUERY = `
	query DeploymentRemediationDiff($attemptId: String!) {
		deploymentRemediationDiff(attemptId: $attemptId)
	}
`;

const APPROVE_DEPLOYMENT_REMEDIATION_MUTATION = `
	mutation ApproveDeploymentRemediation($attemptId: String!) {
		approveDeploymentRemediation(attemptId: $attemptId) {
			${DEPLOYMENT_REMEDIATION_ATTEMPT_FIELDS}
		}
	}
`;

const REJECT_DEPLOYMENT_REMEDIATION_MUTATION = `
	mutation RejectDeploymentRemediation($attemptId: String!) {
		rejectDeploymentRemediation(attemptId: $attemptId) {
			${DEPLOYMENT_REMEDIATION_ATTEMPT_FIELDS}
		}
	}
`;

const DELETE_DEPLOYMENT_MUTATION = `
	mutation DeleteDeployment($payload: DeleteDeploymentInput!) {
		deleteDeployment(payload: $payload) {
			status
			message
		}
	}
`;

const DEPLOYMENT_CONTROL_MUTATION = `
	mutation DeploymentControl($input: DeploymentControlInput!) {
		deploymentControl(input: $input) {
			status
			message
		}
	}
`;

const RESOLVE_REPO_QUERY = `
	query ResolveRepo($owner: String!, $repo: String!) {
		resolveRepo(owner: $owner, repo: $repo) {
			id
			name
			full_name
			html_url
			language
			languages_url
			created_at
			updated_at
			pushed_at
			default_branch
			private
			visibility
			owner {
				login
			}
			latest_commit {
				message
				author
				date
				sha
				url
			}
			branches {
				name
				commit_sha
				protected
			}
		}
	}
`;

const ADD_PUBLIC_REPO_MUTATION = `
	mutation AddPublicRepo($owner: String!, $repo: String!) {
		addPublicRepo(owner: $owner, repo: $repo) {
			id
			name
			full_name
			html_url
			language
			languages_url
			created_at
			updated_at
			pushed_at
			default_branch
			private
			visibility
			owner {
				login
			}
			latest_commit {
				message
				author
				date
				sha
				url
			}
			branches {
				name
				commit_sha
				protected
			}
		}
	}
`;

const DETECT_SERVICES_MUTATION = `
	mutation DetectServices($url: String!, $branch: String) {
		detectServices(url: $url, branch: $branch) {
			isMonorepo
			isMultiService
			services {
				name
				path
				language
				framework
				port
			}
			packageManager
		}
	}
`;

const DETECT_SERVICES_RESULT_FIELDS = `
	isMonorepo
	isMultiService
	services {
		name
		path
		language
		framework
		port
	}
	packageManager
`;

const ADD_REPO_SERVICE_ROOT_MUTATION = `
	mutation AddRepoServiceRoot($url: String!, $branch: String, $rootPath: String!, $displayName: String) {
		addRepoServiceRoot(url: $url, branch: $branch, rootPath: $rootPath, displayName: $displayName) {
			${DETECT_SERVICES_RESULT_FIELDS}
		}
	}
`;

const REMOVE_REPO_SERVICE_MUTATION = `
	mutation RemoveRepoService($url: String!, $serviceName: String!) {
		removeRepoService(url: $url, serviceName: $serviceName) {
			${DETECT_SERVICES_RESULT_FIELDS}
		}
	}
`;

const UPDATE_CUSTOM_DOMAIN_MUTATION = `
	mutation UpdateCustomDomain($repoName: String!, $serviceName: String!, $customUrl: String) {
		updateCustomDomain(repoName: $repoName, serviceName: $serviceName, customUrl: $customUrl) {
			status
			message
			customUrl
		}
	}
`;

const VERIFY_DNS_MUTATION = `
	mutation VerifyDns($subdomain: String!, $repoName: String, $serviceName: String) {
		verifyDns(subdomain: $subdomain, repoName: $repoName, serviceName: $serviceName) {
			available
			isOwned
			subdomain
			customUrl
			alternatives
			message
		}
	}
`;

const CLONE_REPO_MUTATION = `
	mutation CloneRepo($repoUrl: String!, $repoName: String!) {
		cloneRepo(repoUrl: $repoUrl, repoName: $repoName) {
			message
		}
	}
`;

const PREFILL_INFRA_MUTATION = `
	mutation PrefillInfra($url: String!, $branch: String, $packagePath: String) {
		prefillInfra(url: $url, branch: $branch, packagePath: $packagePath) {
			found
			branch
			results {
				commit_sha
				stack_summary
				services {
					name
					build_context
					port
					dockerfile_path
					language
					framework
				}
				dockerfiles
				docker_compose
				nginx_conf
				has_existing_dockerfiles
				has_existing_compose
				risks
				confidence
				hadolint_results
				token_usage {
					input_tokens
					output_tokens
					total_tokens
				}
			}
		}
	}
`;

const LATEST_COMMIT_QUERY = `
	query LatestCommit($owner: String!, $repo: String!, $branch: String) {
		latestCommit(owner: $owner, repo: $repo, branch: $branch) {
			sha
			message
			author
			date
			url
		}
	}
`;

export type DetectServicesResult = {
	isMonorepo: boolean;
	isMultiService: boolean;
	services: DetectedServiceInfo[];
	packageManager?: string | null;
};

export type UpdateCustomDomainResult = {
	status: string;
	message?: string | null;
	customUrl?: string | null;
};

export type VerifyDnsResult = {
	available: boolean;
	isOwned?: boolean;
	subdomain: string;
	customUrl?: string | null;
	alternatives?: string[];
	message?: string | null;
};

export type LatestCommit = {
	sha: string;
	message: string;
	author: string;
	date: string;
	url: string;
};

export type PrefillInfraResult = {
	found: boolean;
	branch?: string;
	results?: SDArtifactsResponse | null;
};

export async function deleteDeployment(repoName: string, serviceName: string): Promise<void> {
	await graphQLRequest(DELETE_DEPLOYMENT_MUTATION, {
		payload: { repoName, serviceName },
	});
}

export async function controlDeployment(action: "pause" | "resume" | "stop", repoName?: string, serviceName?: string): Promise<void> {
	await graphQLRequest(DEPLOYMENT_CONTROL_MUTATION, {
		input: { action, repoName, serviceName },
	});
}

export async function resolveRepo(owner: string, repo: string): Promise<repoType | null> {
	const data = await graphQLRequest<{ resolveRepo: repoType | null }>(RESOLVE_REPO_QUERY, { owner, repo });
	return data.resolveRepo ?? null;
}

export async function addPublicRepo(owner: string, repo: string): Promise<repoType | null> {
	const data = await graphQLRequest<{ addPublicRepo: repoType | null }>(ADD_PUBLIC_REPO_MUTATION, { owner, repo });
	return data.addPublicRepo ?? null;
}

export async function detectRepoServices(url: string, branch?: string): Promise<DetectServicesResult> {
	const variables: Record<string, unknown> = { url };
	if (branch) variables.branch = branch;
	const data = await graphQLRequest<{ detectServices: DetectServicesResult }>(DETECT_SERVICES_MUTATION, variables);
	return data.detectServices;
}

export async function addRepoServiceRoot(
	url: string,
	branch: string | undefined,
	rootPath: string,
	displayName?: string | null
): Promise<DetectServicesResult> {
	const variables: Record<string, unknown> = { url, rootPath };
	if (branch) variables.branch = branch;
	if (displayName != null && String(displayName).trim()) {
		variables.displayName = String(displayName).trim();
	}
	const data = await graphQLRequest<{ addRepoServiceRoot: DetectServicesResult }>(
		ADD_REPO_SERVICE_ROOT_MUTATION,
		variables
	);
	return data.addRepoServiceRoot;
}

export async function removeRepoService(url: string, serviceName: string): Promise<DetectServicesResult> {
	const data = await graphQLRequest<{ removeRepoService: DetectServicesResult }>(REMOVE_REPO_SERVICE_MUTATION, {
		url,
		serviceName,
	});
	return data.removeRepoService;
}

export async function updateCustomDomain(
	repoName: string,
	serviceName: string,
	customUrl?: string
): Promise<UpdateCustomDomainResult> {
	const variables: Record<string, unknown> = { repoName, serviceName };
	if (typeof customUrl === "string") {
		variables.customUrl = customUrl;
	}
	const data = await graphQLRequest<{ updateCustomDomain: UpdateCustomDomainResult }>(
		UPDATE_CUSTOM_DOMAIN_MUTATION,
		variables
	);
	return data.updateCustomDomain;
}

export async function verifyDns(
	subdomain: string,
	repoName?: string,
	serviceName?: string
): Promise<VerifyDnsResult> {
	const variables: Record<string, unknown> = { subdomain };
	if (repoName) variables.repoName = repoName;
	if (serviceName) variables.serviceName = serviceName;
	const data = await graphQLRequest<{ verifyDns: VerifyDnsResult }>(VERIFY_DNS_MUTATION, variables);
	return data.verifyDns;
}

export async function cloneRepo(repoUrl: string, repoName: string): Promise<string> {
	const data = await graphQLRequest<{ cloneRepo: { message: string } }>(CLONE_REPO_MUTATION, { repoUrl, repoName });
	return data.cloneRepo?.message ?? "Repository cloned";
}

export async function prefillInfra(url: string, branch?: string, packagePath?: string): Promise<PrefillInfraResult> {
	const variables: Record<string, unknown> = { url };
	if (branch) variables.branch = branch;
	if (packagePath) variables.packagePath = packagePath;
	const data = await graphQLRequest<{ prefillInfra: PrefillInfraResult }>(PREFILL_INFRA_MUTATION, variables);
	return data.prefillInfra;
}

export async function fetchLatestCommit(owner: string, repo: string, branch?: string): Promise<LatestCommit> {
	const variables: Record<string, unknown> = { owner, repo };
	if (branch) variables.branch = branch;
	const data = await graphQLRequest<{ latestCommit: LatestCommit }>(LATEST_COMMIT_QUERY, variables);
	return data.latestCommit;
}
