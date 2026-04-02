/**
 * useActiveDeployment
 * Derives the active deployment based on selected repo and service
 */

import { useMemo } from "react";
import { DeployConfig } from "@/app/types";
import { useAppData } from "@/store/useAppData";

export function useActiveDeployment(): DeployConfig | undefined {
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);
	const deployments = useAppData((s) => s.deployments);

	return useMemo(() => {
		if (!activeRepo?.name || !activeServiceName) return undefined;
		return deployments.find(
			(dep) => dep.repo_name === activeRepo.name && dep.service_name === activeServiceName
		);
	}, [deployments, activeRepo?.name, activeServiceName]);
}
