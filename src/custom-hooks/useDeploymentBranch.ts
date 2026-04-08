/**
 * useDeploymentBranch
 * Centralizes all branch resolution logic and default branch selection
 */

import { useMemo, useCallback } from "react";
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
	const effectiveBranch = useMemo(() => {
		if (!repo) return "";
		// If deployment has a branch, validate it against remote branches
		if (deployment?.branch) {
			return resolveWorkspaceBranch(repo, deployment.branch);
		}
		// Otherwise use GitHub's default branch
		return resolveInitialRepoBranch(repo);
	}, [repo, deployment?.branch]);

	// Persist corrected branch if DB had a stale value (e.g. "main" when repo uses "master")
	const persistCorrectedBranch = useCallback(async () => {
		if (!repo?.name || !serviceName || !deployment?.branch) return;
		const names = branchNamesFromRepo(repo);
		if (names.length === 0) return;

		const stored = deployment.branch.trim();
		if (!stored || names.includes(stored)) return; // Already valid

		// Branch in DB doesn't exist on remote - correct it
		const corrected = resolveWorkspaceBranch(repo, deployment.branch);
		if (corrected && corrected !== stored) {
			console.debug(`[Branch] Correcting stale branch "${stored}" → "${corrected}"`);
			await onUpdateBranch(corrected);
		}
	}, [repo, deployment?.branch, serviceName, onUpdateBranch]);

	return {
		effectiveBranch,
		persistCorrectedBranch,
	};
}
