/**
 * useDeploymentBranch
 * Centralizes all branch resolution logic and default branch selection
 */

import { branchNamesFromRepo, resolveInitialRepoBranch, resolveWorkspaceBranch } from "@/lib/repoBranch";
import { repoType, DeployConfig } from "@/app/types";

interface UseDeploymentBranchProps {
	repo: repoType | null | undefined;
	deployment: DeployConfig | undefined;
	serviceName: string | undefined;
	onUpdateBranch: (branch: string) => Promise<void>;
}

export function useDeploymentBranch({
	repo,
	deployment,
	serviceName,
	onUpdateBranch,
}: UseDeploymentBranchProps) {
	// Determine the effective branch, preferring database value if it's valid, otherwise use GitHub default
	const effectiveBranch = (() => {
		if (!repo) return "";
		if (deployment?.branch) {
			return resolveWorkspaceBranch(repo, deployment.branch);
		}
		return resolveInitialRepoBranch(repo);
	})();

	// Persist corrected branch if DB had a stale value (e.g. "main" when repo uses "master")
	const persistCorrectedBranch = async () => {
		if (!repo?.name || !serviceName || !deployment?.branch) return;

		const names = branchNamesFromRepo(repo);
		if (names.length === 0) return;

		const stored = deployment.branch.trim();
		if (!stored || names.includes(stored)) return;

		const corrected = resolveWorkspaceBranch(repo, deployment.branch);
		if (corrected && corrected !== stored) {
			console.debug(`[Branch] Correcting stale branch "${stored}" -> "${corrected}"`);
			await onUpdateBranch(corrected);
		}
	};

	return {
		effectiveBranch,
		persistCorrectedBranch,
	};
}
