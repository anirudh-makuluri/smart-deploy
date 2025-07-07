import { DeployConfig, repoType } from '@/app/types';
import { create } from 'zustand';

type AppState = {
	repoList: repoType[];
	deployments: DeployConfig[];
	isLoading: boolean;
	fetchAll: () => Promise<void>;
	updateDeploymentById: (deployment: DeployConfig) => Promise<void>;
};

export const useAppData = create<AppState>((set, get) => ({
	repoList: [],
	deployments: [],
	isLoading: true,

	fetchAll: async () => {
		set({ isLoading: true });
		try {
			const [res1, res2] = await Promise.all([
				fetch('/api/session').then((r) => r.json()),
				fetch('/api/get-deployments').then((r) => r.json()),
			]);

			let repoList = []
			if (res1.repoList) {
				repoList = res1.repoList
			}

			let deployments = []
			if (res2.deployments) {
				deployments = res2.deployments
			}

			set({ repoList, deployments, isLoading: false });
		} catch (err) {
			console.error("API fetch failed", err);
			set({ isLoading: false });
		}
	},

	updateDeploymentById: async (newDeployment: DeployConfig) => {
		const response = await fetch("/api/update-deployments", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify(newDeployment)
		}).then(res => res.json())

		if (response.status == "error") {
			console.log(response.message);
			return;
		}

		const deployments = get().deployments;


		let updatedList;

		if (newDeployment.status === "stopped") {
			// Remove the deployment from the list
			updatedList = deployments.filter(dep => dep.id !== newDeployment.id);
		} else {
			// Update or insert the deployment
			const exists = deployments.some(dep => dep.id === newDeployment.id);
			if (exists) {
				updatedList = deployments.map(dep =>
					dep.id === newDeployment.id ? newDeployment : dep
				);
			} else {
				updatedList = [...deployments, newDeployment];
			}
		}

		set({ deployments: updatedList });
	}
}));