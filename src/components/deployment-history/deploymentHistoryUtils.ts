import type { DeployConfig, DeploymentHistoryEntry, DeploymentReleaseArtifact } from "@/app/types";
import { hasUsableReleaseArtifact } from "@/lib/deploymentReleaseArtifacts";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function deploymentSnapshotFromArtifact(
	artifact: DeploymentReleaseArtifact | Record<string, unknown> | undefined
): Record<string, unknown> | null {
	if (!hasUsableReleaseArtifact(artifact)) return null;
	return isRecord(artifact.deployConfig) ? artifact.deployConfig : null;
}

export function doesEntryMatchActiveDeployment(
	entry: DeploymentHistoryEntry,
	activeDeployment: DeployConfig | null | undefined,
	activeDeploymentStatus: DeployConfig["status"] | null | undefined
): boolean {
	if (!entry.success || !activeDeployment) return false;
	if (activeDeploymentStatus !== "running" && activeDeploymentStatus !== "paused") return false;

	const snapshot = deploymentSnapshotFromArtifact(entry.releaseArtifact);
	if (!snapshot) return false;

	const repoName = typeof snapshot.repoName === "string" ? snapshot.repoName : entry.repo_name;
	const serviceName = typeof snapshot.serviceName === "string" ? snapshot.serviceName : entry.service_name;
	if (repoName !== activeDeployment.repoName || serviceName !== activeDeployment.serviceName) return false;

	const commitSha = typeof snapshot.commitSha === "string" ? snapshot.commitSha : entry.commitSha;
	if (commitSha && activeDeployment.commitSha && commitSha !== activeDeployment.commitSha) return false;

	const branch = typeof snapshot.branch === "string" ? snapshot.branch : entry.branch;
	if (branch && activeDeployment.branch && branch !== activeDeployment.branch) return false;

	const cloudProvider = typeof snapshot.cloudProvider === "string" ? snapshot.cloudProvider : activeDeployment.cloudProvider;
	if (cloudProvider && activeDeployment.cloudProvider && cloudProvider !== activeDeployment.cloudProvider) return false;

	const deploymentTarget =
		typeof snapshot.deploymentTarget === "string" ? snapshot.deploymentTarget : activeDeployment.deploymentTarget;
	if (deploymentTarget && activeDeployment.deploymentTarget && deploymentTarget !== activeDeployment.deploymentTarget) {
		return false;
	}

	const region = typeof snapshot.region === "string" ? snapshot.region : activeDeployment.region;
	if (region && activeDeployment.region && region !== activeDeployment.region) return false;

	return true;
}
