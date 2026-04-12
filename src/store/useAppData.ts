import { DeployConfig, repoType, RepoServicesRecord, DetectedServiceInfo } from '@/app/types';
import { create } from 'zustand';
import {
	fetchAppOverview,
	fetchRepoDeployments as fetchRepoDeploymentsGraphql,
	fetchRepoServices,
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
	[...list].sort((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});

const sortDeployments = (list: DeployConfig[]) =>
	[...list].sort((a, b) => {
		const dateA = a.lastDeployment ? new Date(a.lastDeployment).getTime() : 0;
		const dateB = b.lastDeployment ? new Date(b.lastDeployment).getTime() : 0;
		return dateB - dateA;
	});

type AppState = {
	repoList: repoType[];
	deployments: DeployConfig[];
	activeRepo: repoType | null;
	/** Detected services per repo (from detect-services, persisted in DB). */
	repoServices: RepoServicesRecord[];
	/** In-memory cache of detect-services result per repo URL (avoids refetch on every visit). */
	detectedRepoCache: Record<string, DetectedRepoCacheEntry>;
	isLoading: boolean;
	/** Set after first successful fetch so we don't refetch on every mount/navigation. */
	hasFetched: boolean;
	unAuthenticated: () => void;
	/** Hydrate store (e.g. from TanStack Query). Use when showing UI immediately and loading in background. */
	setAppData: (repoList: repoType[], deployments: DeployConfig[], isLoading?: boolean, repoServices?: RepoServicesRecord[]) => void;
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
	mergeRepoServices: (records: RepoServicesRecord[]) => void;
	/** Refetch repo services only (e.g. after visiting a repo page that ran detect-services). */
	refetchRepoServices: () => Promise<void>;
	/** Get cached detect-services result for a repo (normalized URL). */
	getDetectedRepoCache: (repoUrl: string) => DetectedRepoCacheEntry | undefined;
	/** Set cached detect-services result for a repo. */
	setDetectedRepoCache: (repoUrl: string, data: DetectedRepoCacheEntry) => void;
	updateDeploymentById: (deployment: Partial<DeployConfig> & { repoName: string; serviceName: string }) => Promise<void>;
	removeDeployment: (repoName: string, serviceName: string) => void;
	/** Remove multiple deployments in one update (e.g. after bulk delete). */
	removeDeployments: (keys: { repoName: string; serviceName: string }[]) => void;
	refreshRepoList: () => Promise<{ status: 'success' | 'error'; message: string }>;
	activeServiceName: string | null;
	setActiveRepo: (repo: repoType | null) => void;
	setActiveServiceName: (name: string | null) => void;
};

function normalizeRepoUrlForCache(url: string): string {
	return url.replace(/\.git$/, '').toLowerCase().trim();
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

	const deploymentUrl = normalizeRepoIdentifier(deployment.url ?? "");
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

	return sortDeployments(Array.from(merged.values()));
}

function repoServicesKey(record: Pick<RepoServicesRecord, "repo_url">): string {
	return normalizeRepoUrlForCache(record.repo_url);
}

function mergeRepoServicesLists(
	existing: RepoServicesRecord[],
	incoming: RepoServicesRecord[]
): RepoServicesRecord[] {
	const merged = new Map<string, RepoServicesRecord>();

	for (const record of existing) {
		merged.set(repoServicesKey(record), record);
	}

	for (const record of incoming) {
		merged.set(repoServicesKey(record), record);
	}

	return Array.from(merged.values());
}

export const useAppData = create<AppState>((set, get) => ({
	repoList: [],
	deployments: [],
	activeRepo: null,
	repoServices: [],
	detectedRepoCache: {},
	isLoading: true,
	hasFetched: false,
	activeServiceName: null,

	unAuthenticated: () => {
		set({ isLoading: false, hasFetched: false });
	},

	setAppData: (repoList, deployments, isLoading = false, repoServicesPayload = []) => {
		set({
			repoList: sortRepos(repoList),
			deployments: mergeDeploymentLists([], deployments),
			repoServices: mergeRepoServicesLists([], repoServicesPayload),
			isLoading,
			hasFetched: !isLoading,
		});
	},

	fetchAll: async () => {
		const { hasFetched } = get();
		if (hasFetched) return; // Already have data; avoid refetching on every navigation
		set({ isLoading: true });
		try {
			const { repoList, deployments, repoServices } = await fetchAppOverview();
			set({
				repoList: sortRepos(repoList),
				deployments: mergeDeploymentLists([], deployments),
				repoServices: mergeRepoServicesLists([], repoServices ?? []),
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
			const { repoList, deployments, repoServices } = await fetchAppOverview();
			set({
				repoList: sortRepos(repoList),
				deployments: mergeDeploymentLists([], deployments),
				repoServices: mergeRepoServicesLists([], repoServices ?? []),
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

	mergeRepoServices: (incomingRecords) => {
		set((state) => ({
			repoServices: mergeRepoServicesLists(state.repoServices, incomingRecords),
		}));
	},

	refetchRepoServices: async () => {
		try {
			const services = await fetchRepoServices();
			set((state) => ({
				repoServices: mergeRepoServicesLists(state.repoServices, services ?? []),
			}));
		} catch (err) {
			console.error('Refetch repo services failed', err);
		}
	},

	getDetectedRepoCache: (repoUrl: string) => {
		const key = normalizeRepoUrlForCache(repoUrl);
		return get().detectedRepoCache[key];
	},

	setDetectedRepoCache: (repoUrl: string, data: DetectedRepoCacheEntry) => {
		const key = normalizeRepoUrlForCache(repoUrl);
		set((state) => ({
			detectedRepoCache: { ...state.detectedRepoCache, [key]: data },
		}));
	},

	updateDeploymentById: async (partial: Partial<DeployConfig> & { repoName: string; serviceName: string }) => {
		try {
			await graphQLUpdateDeployment(partial as DeployConfig);
		} catch (err) {
			console.log((err as Error).message);
			return;
		}

		const deployments = get().deployments;
		const matchKey = (dep: DeployConfig) =>
			dep.repoName === partial.repoName && dep.serviceName === partial.serviceName;

		const existing = deployments.find(matchKey);
		const merged: DeployConfig = {
			...(existing ?? ({} as DeployConfig)),
			...partial,
		};

		let updatedList: DeployConfig[];
		if (merged.status === 'stopped') {
			updatedList = deployments.filter((dep) => !matchKey(dep));
		} else {
			const exists = Boolean(existing);
			updatedList = exists
				? deployments.map((dep) => (matchKey(dep) ? merged : dep))
				: [...deployments, merged];
		}

		set({ deployments: mergeDeploymentLists([], updatedList) });
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
