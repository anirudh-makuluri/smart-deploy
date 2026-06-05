import type {
	DeployConfig,
	DeploymentReleaseArtifact,
	EcrImageReleaseArtifact,
	EcrServiceImageRef,
	Ec2ConfigReleaseArtifact,
	StaticSiteReleaseArtifact,
} from "@/app/types";

function cloneJsonObject<T>(value: T): T {
	if (!value || typeof value !== "object") return value;
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sanitizeDeployConfigForHistory(config: DeployConfig | null): Record<string, unknown> {
	if (!config) return {};
	const snapshot = cloneJsonObject(config) as Record<string, unknown>;
	delete snapshot.envVars;
	return snapshot;
}

export function buildEc2ConfigReleaseArtifact(deployConfig: DeployConfig): Ec2ConfigReleaseArtifact {
	return {
		kind: "ec2_config",
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		branch: deployConfig.branch ?? null,
		commitSha: deployConfig.commitSha ?? null,
		deployConfig: sanitizeDeployConfigForHistory(deployConfig),
	};
}

export function buildEcrImageReleaseArtifact(args: {
	deployConfig: DeployConfig;
	region: string;
	ecrRegistry: string;
	ecrRepoName: string;
	imageTag: string;
	imageUri: string;
	imageDigest?: string | null;
	serviceImages?: EcrServiceImageRef[];
}): EcrImageReleaseArtifact {
	return {
		kind: "ecr_image",
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		region: args.region,
		ecrRegistry: args.ecrRegistry,
		ecrRepoName: args.ecrRepoName,
		imageTag: args.imageTag,
		imageUri: args.imageUri,
		imageDigest: args.imageDigest ?? null,
		serviceImages: args.serviceImages ?? [],
		branch: args.deployConfig.branch ?? null,
		commitSha: args.deployConfig.commitSha ?? null,
		deployConfig: sanitizeDeployConfigForHistory(args.deployConfig),
	};
}

export function attachDeployConfigToReleaseArtifact(
	artifact: DeploymentReleaseArtifact | Record<string, unknown> | null | undefined,
	deployConfig: DeployConfig
): DeploymentReleaseArtifact | Record<string, unknown> | null {
	if (!artifact || !isRecord(artifact)) return null;
	const copy = cloneJsonObject(artifact) as Record<string, unknown>;
	copy.deployConfig = sanitizeDeployConfigForHistory(deployConfig);
	return copy as DeploymentReleaseArtifact | Record<string, unknown>;
}

export function isEcrImageReleaseArtifact(value: unknown): value is EcrImageReleaseArtifact {
	return isRecord(value) && value.kind === "ecr_image";
}

export function isEc2ConfigReleaseArtifact(value: unknown): value is Ec2ConfigReleaseArtifact {
	return isRecord(value) && value.kind === "ec2_config";
}

export function buildStaticSiteReleaseArtifact(args: {
	deployConfig: DeployConfig;
	region: string;
	bucket: string;
	keyPrefix: string;
	publicBaseUrl: string;
	cloudFrontDistributionId?: string | null;
}): StaticSiteReleaseArtifact {
	const baseUrl = args.publicBaseUrl.trim().replace(/\/+$/, "");
	return {
		kind: "static_site",
		cloudProvider: "aws",
		deploymentTarget: "static_s3",
		region: args.region,
		bucket: args.bucket,
		keyPrefix: args.keyPrefix,
		publicBaseUrl: baseUrl,
		cloudFrontDistributionId: args.cloudFrontDistributionId ?? null,
		branch: args.deployConfig.branch ?? null,
		commitSha: args.deployConfig.commitSha ?? null,
		deployConfig: sanitizeDeployConfigForHistory(args.deployConfig),
	};
}

export function isStaticSiteReleaseArtifact(value: unknown): value is StaticSiteReleaseArtifact {
	return isRecord(value) && value.kind === "static_site";
}

export function hasUsableReleaseArtifact(value: unknown): value is DeploymentReleaseArtifact {
	return isEcrImageReleaseArtifact(value) || isEc2ConfigReleaseArtifact(value) || isStaticSiteReleaseArtifact(value);
}

export function ecrImageRefFromArtifact(artifact: EcrImageReleaseArtifact): string {
	if (artifact.imageDigest) {
		const base = artifact.imageUri.includes("@")
			? artifact.imageUri.split("@")[0]
			: artifact.imageUri.replace(/:[^/:@]+$/, "");
		return `${base}@${artifact.imageDigest}`;
	}
	return artifact.imageUri;
}

export function serviceImageRefsFromArtifact(artifact: EcrImageReleaseArtifact): EcrServiceImageRef[] {
	return (artifact.serviceImages ?? []).map((serviceImage) => {
		const imageUri = serviceImage.imageDigest
			? `${serviceImage.imageUri.includes("@") ? serviceImage.imageUri.split("@")[0] : serviceImage.imageUri.replace(/:[^/:@]+$/, "")}@${serviceImage.imageDigest}`
			: serviceImage.imageUri;
		return {
			...serviceImage,
			imageUri,
		};
	});
}

export function deployConfigFromReleaseArtifact(
	artifact: DeploymentReleaseArtifact,
	currentDeployConfig: DeployConfig
): DeployConfig | null {
	if (!isRecord(artifact.deployConfig)) return null;
	const storedConfig = cloneJsonObject(artifact.deployConfig) as Partial<DeployConfig> & Record<string, unknown>;
	delete storedConfig.envVars;
	const artifactTarget = (artifact as { deploymentTarget?: DeployConfig["deploymentTarget"] }).deploymentTarget;
	const storedTarget = storedConfig.deploymentTarget as DeployConfig["deploymentTarget"] | undefined;
	const resolvedTarget: DeployConfig["deploymentTarget"] =
		isStaticSiteReleaseArtifact(artifact) ? "static_s3" : artifactTarget || storedTarget || "ec2";
	return {
		...currentDeployConfig,
		...storedConfig,
		envVars: currentDeployConfig.envVars ?? null,
		repoName: (storedConfig.repoName as string | undefined) || currentDeployConfig.repoName,
		serviceName: (storedConfig.serviceName as string | undefined) || currentDeployConfig.serviceName,
		url: (storedConfig.url as string | undefined) || currentDeployConfig.url,
		branch: (storedConfig.branch as string | undefined) || currentDeployConfig.branch,
		cloudProvider: "aws",
		deploymentTarget: resolvedTarget,
	} as DeployConfig;
}

export const __testing = {
	isRecord,
};
