import { DeployConfig, repoType } from '@/app/types';
import { create } from 'zustand';

const sortRepos = (list: repoType[]) =>
	[...list].sort((a, b) => {
		const dateA = a.latest_commit?.date ? new Date(a.latest_commit.date).getTime() : 0;
		const dateB = b.latest_commit?.date ? new Date(b.latest_commit.date).getTime() : 0;
		return dateB - dateA;
	});

const sortDeployments = (list: DeployConfig[]) =>
	[...list].sort((a, b) => {
		const dateA = a.last_deployment ? new Date(a.last_deployment).getTime() : 0;
		const dateB = b.last_deployment ? new Date(b.last_deployment).getTime() : 0;
		return dateB - dateA;
	});

type AppState = {
	repoList: repoType[];
	deployments: DeployConfig[];
	isLoading: boolean;
	/** Set after first successful fetch so we don't refetch on every mount/navigation. */
	hasFetched: boolean;
	unAuthenticated: () => void;
	/** Hydrate store (e.g. from TanStack Query). Use when showing UI immediately and loading in background. */
	setAppData: (repoList: repoType[], deployments: DeployConfig[], isLoading?: boolean) => void;
	/** Load repos + deployments (runs once when authenticated; skips if already fetched). */
	fetchAll: () => Promise<void>;
	/** Force refetch from server (e.g. after long time or explicit "Refresh" action). */
	refetchAll: () => Promise<void>;
	updateDeploymentById: (deployment: DeployConfig) => Promise<void>;
	removeDeployment: (deploymentId: string) => void;
	refreshRepoList: () => Promise<{ status: 'success' | 'error'; message: string }>;
};

export const useAppData = create<AppState>((set, get) => ({
	repoList: [],
	deployments: [],
	isLoading: true,
	hasFetched: false,

	unAuthenticated: () => {
		set({ isLoading: false, hasFetched: false });
	},

	setAppData: (repoList, deployments, isLoading = false) => {
		set({
			repoList: sortRepos(repoList),
			deployments: sortDeployments(deployments),
			isLoading,
			hasFetched: !isLoading,
		});
	},

	fetchAll: async () => {
		const { hasFetched } = get();
		if (hasFetched) return; // Already have data; avoid refetching on every navigation
		set({ isLoading: true });
		try {
			const [res1, res2] = await Promise.all([
				fetch('/api/session').then((r) => r.json()),
				fetch('/api/get-deployments').then((r) => r.json()),
			]);

			let repoList: repoType[] = res1.repoList ?? [];
			let deployments: DeployConfig[] = res2.deployments ?? [];
			repoList = sortRepos(repoList);
			deployments = sortDeployments(deployments);

			set({ repoList, deployments, isLoading: false, hasFetched: true });
		} catch (err) {
			console.error('API fetch failed', err);
			set({ isLoading: false });
		}
	},

	refetchAll: async () => {
		set({ isLoading: true });
		try {
			const [res1, res2] = await Promise.all([
				fetch('/api/session').then((r) => r.json()),
				fetch('/api/get-deployments').then((r) => r.json()),
			]);

			let repoList: repoType[] = res1.repoList ?? [];
			let deployments: DeployConfig[] = res2.deployments ?? [];
			repoList = sortRepos(repoList);
			deployments = sortDeployments(deployments);

			set({ repoList, deployments, isLoading: false, hasFetched: true });
		} catch (err) {
			console.error('Refetch failed', err);
			set({ isLoading: false });
		}
	},

	updateDeploymentById: async (newDeployment: DeployConfig) => {
		const response = await fetch('/api/update-deployments', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(newDeployment),
		}).then((res) => res.json());

		if (response.status === 'error') {
			console.log(response.message);
			return;
		}

		const deployments = get().deployments;
		let updatedList: DeployConfig[];
		if (newDeployment.status === 'stopped') {
			updatedList = deployments.filter((dep) => dep.id !== newDeployment.id);
		} else {
			const exists = deployments.some((dep) => dep.id === newDeployment.id);
			updatedList = exists
				? deployments.map((dep) => (dep.id === newDeployment.id ? newDeployment : dep))
				: [...deployments, newDeployment];
		}
		set({ deployments: sortDeployments(updatedList) });
	},

	removeDeployment: (deploymentId: string) => {
		set((state) => ({
			deployments: sortDeployments(
				state.deployments.filter((dep) => dep.id !== deploymentId)
			),
		}));
	},

	refreshRepoList: async () => {
		const response = await fetch('/api/repos/refresh', { method: 'GET' }).then((res) =>
			res.json()
		);
		if (response.status === 'success' && response.repoList) {
			set({ repoList: sortRepos(response.repoList) });
		}
		return { status: response.status ?? 'error', message: response.message ?? '' };
	},
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
