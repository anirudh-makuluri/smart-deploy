/**
 * useActiveDeployment
 * Derives the active deployment based on selected repo and service
 * Returns either the found deployment or a default one with empty/null values
 */

import { useMemo } from "react";
import { DeployConfig } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import config from "@/config";

function createDefaultDeployment(repoName: string, serviceName: string, repoUrl?: string, branch?: string): DeployConfig {
	return {
		id: `draft-${repoName}-${serviceName}`,
		repoName,
		serviceName,
		url: repoUrl || "",
		branch: branch || "",
		commitSha: null,
		envVars: null,
		liveUrl: null,
		screenshotUrl: null,
		status: "didnt_deploy",
		firstDeployment: null,
		lastDeployment: null,
		revision: null,
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		awsRegion: process.env.NEXT_PUBLIC_AWS_REGION || config.AWS_REGION || "us-west-2",
		ec2: null,
		cloudRun: null,
		scanResults: {},
	};
}

export function useActiveDeployment(): DeployConfig {
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);
	const deployments = useAppData((s) => s.deployments);

	return useMemo(() => {
		if (!activeRepo?.name || !activeServiceName) {
			return createDefaultDeployment("", "", "");
		}

		const found = deployments.find(
			(dep) => dep.repoName === activeRepo.name && dep.serviceName === activeServiceName
		);

		if (found) return found;

		return createDefaultDeployment(activeRepo.name, activeServiceName, activeRepo.html_url, activeRepo.default_branch);
	}, [deployments, activeRepo?.name, activeRepo?.html_url, activeRepo?.default_branch, activeServiceName]);
}
