import { DeployConfig, repoType, RepoRecord, DetectedServiceInfo } from '@/app/types';
import { withDeployInfraDefaults } from '@/lib/deployInfraDefaults';
import { create } from 'zustand';
import {
	fetchAppOverview,
	fetchRepoDeployments as fetchRepoDeploymentsGraphql,
	fetchRepoRecords,
	refreshRepos,
	updateDeployment as graphQLUpdateDeployment,
} from '@/lib/graphqlClient';

export type DetectedRepoCacheEntry = {
	services: DetectedServiceInfo[];
	isMonorepo: boolean;
	isMultiService: boolean;
	packageManager?: string;
};

const sortRepos = (list: repoType[]) =>
	list.toSorted((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});

const sortDeployments = (list: DeployConfig[]) =>
	list.toSorted((a, b) => {
		const dateA = a.lastDeployment ? new Date(a.lastDeployment).getTime() : 0;
		const dateB = b.lastDeployment ? new Date(b.lastDeployment).getTime() : 0;
		return dateB - dateA;
	});

type AppState = {
	repoList: repoType[];
	deployments: DeployConfig[];
	activeRepo: repoType | null;
	activeServiceName: string | null;
	/** The Repo Record that's used right now */
	activeRepoRecord: RepoRecord | null;
	/** Detected services per repo (from detect-services, persisted in DB). */
	repoRecords: RepoRecord[];
	/** In-memory cache of detect-services result per repo URL (avoids refetch on every visit). */
	detectedRepoCache: Record<string, DetectedRepoCacheEntry>;
	isLoading: boolean;
	/** Set after first successful fetch so we don't refetch on every mount/navigation. */
	hasFetched: boolean;
	setRepoRecords: (records: RepoRecord[]) => void;
	unAuthenticated: () => void;
	/** Hydrate store (e.g. from TanStack Query). Use when showing UI immediately and loading in background. */
	setAppData: (repoList: repoType[], deployments: DeployConfig[], repoRecords?: RepoRecord[]) => void;
	/** Load repos + deployments + repo services (runs once when authenticated; skips if already fetched). */
	fetchAll: () => Promise<void>;
	/** Force refetch from server (e.g. after long time or explicit "Refresh" action). */
	refetchAll: () => Promise<void>;
	/** Refetch deployments only (no loading state). Use after delete so UI stays in sync. */
	refetchDeployments: () => Promise<void>;
	/** Fetch deployments for a specific repository. Useful when navigating to a repo page before full fetch. */
	fetchRepoDeployments: (repoName: string) => Promise<void>;
	/** Replace deployments for a specific repository with a fresh repo-scoped result set. */
	syncRepoDeployments: (repoName: string, deployments: DeployConfig[]) => void;
	/** Merge fetched deployments into the local store without writing back to the server. */
	mergeDeployments: (deployments: DeployConfig[]) => void;
	/** Merge fetched repo service records into the local store without replacing unrelated repos. */
	mergeRepoRecords: (records: RepoRecord[]) => void;
	/** Get cached detect-services result for a repo + branch. */
	updateDeploymentById: (deployment: Partial<DeployConfig> & { repoName: string; serviceName: string }) => Promise<void>;
	removeDeployment: (repoName: string, serviceName: string) => void;
	/** Remove multiple deployments in one update (e.g. after bulk delete). */
	removeDeployments: (keys: { repoName: string; serviceName: string }[]) => void;
	refreshRepoList: () => Promise<{ status: 'success' | 'error'; message: string }>;
	setActiveRepo: (repo : repoType | null) => void;
	setActiveRepoRecord: (repoRecord: RepoRecord | null) => void,
	setActiveServiceName: (name: string | null) => void;
};

function normalizeRepoUrlForCache(url: string): string {
	return url.replace(/\.git$/, '').toLowerCase().trim();
}

function repoBranchCacheKey(repoUrl: string, branch?: string): string {
	const normalizedUrl = normalizeRepoUrlForCache(repoUrl);
	const normalizedBranch = (branch ?? "").trim().toLowerCase();
	return normalizedBranch ? `${normalizedUrl}::${normalizedBranch}` : normalizedUrl;
}

function normalizeRepoIdentifier(value: string): string {
	return value
		.trim()
		.replace(/\.git$/, "")
		.replace(/^https?:\/\//, "")
		.replace(/^github\.com\//, "")
		.replace(/\/$/, "")
		.toLowerCase();
}

function matchesRepoIdentifier(deployment: DeployConfig, repoIdentifier: string): boolean {
	const target = normalizeRepoIdentifier(repoIdentifier);
	if (!target) return false;

	const deploymentUrl = normalizeRepoIdentifier(deployment.repoUrl ?? "");
	const deploymentRepoName = normalizeRepoIdentifier(deployment.repoName ?? "");
	const deploymentUrlTail = deploymentUrl.split("/").slice(-2).join("/");

	return deploymentUrl === target || deploymentRepoName === target || deploymentUrlTail === target;
}

function deploymentKey(deployment: Pick<DeployConfig, "repoName" | "serviceName">): string {
	return `${deployment.repoName}::${deployment.serviceName}`.toLowerCase();
}

function mergeDeploymentLists(existing: DeployConfig[], incoming: DeployConfig[]): DeployConfig[] {
	const merged = new Map<string, DeployConfig>();

	for (const deployment of existing) {
		merged.set(deploymentKey(deployment), deployment);
	}

	for (const deployment of incoming) {
		merged.set(deploymentKey(deployment), deployment);
	}

	return sortDeployments(Array.from(merged.values()).map(withDeployInfraDefaults));
}

function repoRecordsKey(record: Pick<RepoRecord, "repo_url" | "branch">): string {
	return repoBranchCacheKey(record.repo_url, record.branch);
}

function mergeRepoRecordsLists(
	existing: RepoRecord[],
	incoming: RepoRecord[]
): RepoRecord[] {
	const merged = new Map<string, RepoRecord>();

	for (const record of existing) {
		merged.set(repoRecordsKey(record), record);
	}

	for (const record of incoming) {
		merged.set(repoRecordsKey(record), record);
	}

	return Array.from(merged.values());
}

export const useAppData = create<AppState>((set, get) => ({
	repoList: [],
	deployments: [],
	activeRepo: null,
	activeRepoRecord: null,
	repoRecords: [],
	detectedRepoCache: {},
	isLoading: true,
	hasFetched: false,
	activeServiceName: null,

	unAuthenticated: () => {
		set({ isLoading: false, hasFetched: false });
	},

	setRepoRecords: (records) => {
		set({ repoRecords: records });
	},

	setAppData: (repoList, deployments, repoRecordsPayload = []) => {
		set({
			repoList: sortRepos(repoList),
			deployments: mergeDeploymentLists([], deployments),
			repoRecords: mergeRepoRecordsLists([], repoRecordsPayload),
			hasFetched: true,
		});
	},

	fetchAll: async () => {
		const { hasFetched } = get();
		if (hasFetched) return; // Already have data; avoid refetching on every navigation
		set({ isLoading: true });
		try {
			const { repoList, deployments, repoRecords } = await fetchAppOverview();
			set({
				repoList: sortRepos(repoList),
				deployments: mergeDeploymentLists([], deployments),
				repoRecords: mergeRepoRecordsLists([], repoRecords ?? []),
				isLoading: false,
				hasFetched: true,
			});
		} catch (err) {
			console.error('API fetch failed', err);
			set({ isLoading: false });
		}
	},

	refetchAll: async () => {
		set({ isLoading: true });
		try {
			const { repoList, deployments, repoRecords } = await fetchAppOverview();
			set({
				repoList: sortRepos(repoList),
				deployments: mergeDeploymentLists([], deployments),
				repoRecords: mergeRepoRecordsLists([], repoRecords ?? []),
				isLoading: false,
				hasFetched: true,
			});
		} catch (err) {
			console.error('Refetch failed', err);
			set({ isLoading: false });
		}
	},

	refetchDeployments: async () => {
		try {
			const { deployments } = await fetchAppOverview();
			const list = deployments ?? [];
			set((state) => ({ deployments: mergeDeploymentLists(state.deployments, list) }));
		} catch (err) {
			console.error('Refetch deployments failed', err);
		}
	},

	fetchRepoDeployments: async (repoIdentifier: string) => {
		try {
			console.log(`Fetching deployments for ${repoIdentifier}...`);
			const fetchedList = await fetchRepoDeploymentsGraphql(repoIdentifier);
			set((state) => ({
				deployments: mergeDeploymentLists(
					state.deployments.filter((d) => !matchesRepoIdentifier(d, repoIdentifier)),
					fetchedList
				),
			}));
		} catch (err) {
			console.error('Fetch repo deployments failed', err);
		}
	},

	syncRepoDeployments: (repoIdentifier, fetchedList) => {
		set((state) => ({
			deployments: mergeDeploymentLists(
				state.deployments.filter((d) => !matchesRepoIdentifier(d, repoIdentifier)),
				fetchedList
			),
		}));
	},

	mergeDeployments: (incomingDeployments) => {
		set((state) => ({
			deployments: mergeDeploymentLists(state.deployments, incomingDeployments),
		}));
	},

	mergeRepoRecords: (incomingRecords) => {
		set((state) => ({
			repoRecords: mergeRepoRecordsLists(state.repoRecords, incomingRecords),
		}));
	},

	updateDeploymentById: async (partial: Partial<DeployConfig> & { repoName: string; serviceName: string }) => {
		try {
			await graphQLUpdateDeployment(partial as DeployConfig);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isStaleDeployConfigSchemaError =
				message.includes('Variable "$config" got invalid value') &&
				message.includes('Field "ec2" is not defined by type "DeployConfigInput"');
			if (!isStaleDeployConfigSchemaError) {
				console.error('updateDeploymentById failed', err);
			}
			return;
		}

		const updatedList = get().deployments;
		const matchKey = (dep: DeployConfig) =>
			dep.repoName === partial.repoName && dep.serviceName === partial.serviceName;

		const existingIndex = updatedList.findIndex(matchKey);
		const existing = existingIndex !== -1 ? updatedList[existingIndex] : {};

		const merged: DeployConfig = withDeployInfraDefaults({
			...existing,
			...partial,
		} as DeployConfig);

		const nextDeployments =
			existingIndex === -1
				? [...updatedList, merged]
				: updatedList.map((deployment, index) => (index === existingIndex ? merged : deployment));

		set({ deployments: mergeDeploymentLists([], nextDeployments) });
	},

	removeDeployment: (repoName: string, serviceName: string) => {
		set((state) => ({
			deployments: sortDeployments(
				state.deployments.filter((dep) => !(dep.repoName === repoName && dep.serviceName === serviceName))
			),
		}));
	},

	removeDeployments: (keys: { repoName: string; serviceName: string }[]) => {
		if (keys.length === 0) return;
		set((state) => ({
			deployments: sortDeployments(
				state.deployments.filter((dep) => !keys.some((k) => k.repoName === dep.repoName && k.serviceName === dep.serviceName))
			),
		}));
	},

	refreshRepoList: async () => {
		try {
			const repoList = await refreshRepos();
			set({ repoList: sortRepos(repoList) });
			return { status: 'success', message: 'Repos refreshed' };
		} catch (err) {
			console.error('Refresh repo list failed', err);
			return { status: 'error', message: (err as Error).message };
		}
	},
	setActiveRepo: (repo) => set({ activeRepo: repo }),
	setActiveRepoRecord: (repoRecord) => set({ activeRepoRecord: repoRecord }),
	setActiveServiceName: (name) => set({ activeServiceName: name }),
}));

// Selectors: subscribe to only what you need to reduce re-renders
export function useRepoList() {
	return useAppData((s) => s.repoList);
}
export function useDeployments() {
	return useAppData((s) => s.deployments);
}
export function useAppDataLoading() {
	return useAppData((s) => s.isLoading);
}
