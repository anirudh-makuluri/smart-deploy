import { DeployConfig, DetectedServiceInfo } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import config from "@/config";
import { getDeploymentForService } from "@/lib/utils";
import { withDeployInfraDefaults } from "@/lib/deployInfraDefaults";
import { hostedSubdomainOrDefault } from "@/lib/hostedUrl";

export function createDefaultDeployment(
	repoName: string,
	serviceName: string,
	repoUrl: string,
	branch: string
): DeployConfig {
	return withDeployInfraDefaults({
		id: `draft-${repoName}-${serviceName}`,
		repoName,
		serviceName,
		repoUrl: repoUrl || "",
		branch: branch || "",
		responseId: null,
		commitSha: null,
		envVars: null,
		hostedSubdomain: hostedSubdomainOrDefault(repoName, null) || null,
		screenshotUrl: null,
		status: "didnt_deploy",
		firstDeployment: null,
		lastDeployment: null,
		revision: null,
		cloudProvider: "aws",
		deploymentTarget: "ecs",
		region: process.env.NEXT_PUBLIC_AWS_REGION || config.AWS_REGION || "",
		cloudResources: null,
		scanResults: {},
	});
}

export function useActiveDeployment(): DeployConfig {
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);
	const deployments = useAppData((s) => s.deployments);

	if (!activeRepo || !activeServiceName) {
		return createDefaultDeployment("", "", "", "");
	}

	const found = getDeploymentForService(
		deployments,
		activeRepo.html_url,
		activeServiceName,
		activeRepo.name
	);

	if (found) return withDeployInfraDefaults(found);

	return createDefaultDeployment(
		activeRepo.name,
		activeServiceName,
		activeRepo.html_url,
		activeRepo.default_branch
	);
}
