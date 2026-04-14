import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";
import { defaultAwsRegionForDeploy } from "@/lib/deployInfraDefaults";

export type PreviewStepId = "auth" | "build" | "setup" | "deploy" | "done";

export type PreviewArtifactKind =
	| "repo"
	| "branch"
	| "commit"
	| "compose"
	| "dockerfiles"
	| "dockerfile"
	| "buildContexts"
	| "ecrOutput"
	| "region"
	| "instanceType"
	| "networking"
	| "envVars"
	| "nginx"
	| "customDomain";

export type PreviewWarningSeverity = "warning" | "info";

export type PreviewWarning = {
	id: string;
	severity: PreviewWarningSeverity;
	title: string;
	description: string;
	stepId: PreviewStepId;
	artifactId?: string;
};

export type PreviewArtifact = {
	id: string;
	stepId: PreviewStepId;
	kind: PreviewArtifactKind;
	title: string;
	subtitle?: string;
	/** Optional action key for the UI to open the editor. */
	action?:
		| "openBranch"
		| "openDockerfile"
		| "openCompose"
		| "openInfra"
		| "openEnvVars"
		| "openNginx"
		| "openCustomDomain";
	/** Optional payload the UI can use (e.g. dockerfile path). */
	meta?: Record<string, string | number | boolean | null | undefined>;
};

export type PreviewStep = {
	id: PreviewStepId;
	label: string;
	description: string;
};

export type PreviewModel = {
	steps: PreviewStep[];
	artifacts: PreviewArtifact[];
	warnings: PreviewWarning[];
	/** True when CodeBuild will build via docker-compose (multi-service). */
	composeBuildMode: boolean;
};

function safeTrim(value: string | null | undefined) {
	return (value ?? "").trim();
}

export function buildPreviewModel(params: {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
}): PreviewModel {
	const { deployment, scanResults } = params;

	const steps: PreviewStep[] = [
		{
			id: "auth",
			label: "Auth & resolve ref",
			description: "Resolve branch/commit and authenticate to start a build.",
		},
		{
			id: "build",
			label: "Clone & build images (CodeBuild)",
			description: "CodeBuild clones the repo, writes generated artifacts, then builds images and pushes to ECR.",
		},
		{
			id: "setup",
			label: "Infra setup (VPC, key, security)",
			description: "Prepare networking, instance permissions, and prerequisites for EC2.",
		},
		{
			id: "deploy",
			label: "Deploy to EC2 (SSM) + reverse proxy",
			description: "Launch/reuse EC2, deploy containers, and configure Nginx routing.",
		},
		{
			id: "done",
			label: "Domain & routing",
			description: "Configure ALB host routing and optional DNS to make the deployment reachable.",
		},
	];

	const services = scanResults?.services ?? [];
	const composeBuildMode = Boolean(scanResults?.docker_compose?.trim()) && services.length > 1;
	const dockerfileCount = Object.keys(scanResults?.dockerfiles ?? {}).length;

	const artifacts: PreviewArtifact[] = [];
	const warnings: PreviewWarning[] = [];

	// ── auth ────────────────────────────────────────────────────────────────
	artifacts.push({
		id: "auth:repo",
		stepId: "auth",
		kind: "repo",
		title: "Repository",
		subtitle: safeTrim(deployment.url) || "Not set",
	});
	artifacts.push({
		id: "auth:branch",
		stepId: "auth",
		kind: "branch",
		title: "Branch",
		subtitle: safeTrim(deployment.branch) || "Not set",
		action: "openBranch",
	});
	if (safeTrim(deployment.commitSha)) {
		artifacts.push({
			id: "auth:commit",
			stepId: "auth",
			kind: "commit",
			title: "Commit",
			subtitle: safeTrim(deployment.commitSha).slice(0, 7),
		});
	}

	// ── build ───────────────────────────────────────────────────────────────
	if (composeBuildMode) {
		artifacts.push({
			id: "build:compose",
			stepId: "build",
			kind: "compose",
			title: "docker-compose.yml",
			subtitle: "Used to build multi-service images",
			action: "openCompose",
		});
	} else {
		artifacts.push({
			id: "build:dockerfiles",
			stepId: "build",
			kind: "dockerfiles",
			title: `Dockerfile${dockerfileCount === 1 ? "" : "s"}`,
			subtitle: dockerfileCount > 0 ? `${dockerfileCount} generated` : "Missing",
			action: "openDockerfile",
		});
	}

	if (composeBuildMode && dockerfileCount > 0) {
		artifacts.push({
			id: "build:dockerfiles",
			stepId: "build",
			kind: "dockerfiles",
			title: `Dockerfile${dockerfileCount === 1 ? "" : "s"}`,
			subtitle: `${dockerfileCount} generated (used by compose builds)`,
			action: "openDockerfile",
		});
	}

	const contexts = Array.from(new Set(services.map((s) => safeTrim(s.build_context)).filter(Boolean)));
	if (contexts.length > 0) {
		artifacts.push({
			id: "build:contexts",
			stepId: "build",
			kind: "buildContexts",
			title: "Build contexts",
			subtitle: contexts.length > 1 ? `${contexts.length} paths` : contexts[0],
		});
	}

	artifacts.push({
		id: "build:ecr",
		stepId: "build",
		kind: "ecrOutput",
		title: "ECR output",
		subtitle: "Images are tagged and pushed for deployment",
	});

	// ── setup ───────────────────────────────────────────────────────────────
	artifacts.push({
		id: "setup:region",
		stepId: "setup",
		kind: "region",
		title: "Region",
		subtitle: safeTrim(deployment.awsRegion) || defaultAwsRegionForDeploy(),
		action: "openInfra",
	});
	artifacts.push({
		id: "setup:instance",
		stepId: "setup",
		kind: "instanceType",
		title: "Instance type",
		subtitle:
			safeTrim(
				deployment.ec2 && typeof deployment.ec2 === "object"
					? String((deployment.ec2 as { instanceType?: string }).instanceType ?? "")
					: ""
			) || DEFAULT_EC2_INSTANCE_TYPE,
		action: "openInfra",
	});
	artifacts.push({
		id: "setup:networking",
		stepId: "setup",
		kind: "networking",
		title: "Networking",
		subtitle: "VPC / subnet / security group will be created or reused",
		action: "openInfra",
	});

	// ── deploy ──────────────────────────────────────────────────────────────
	artifacts.push({
		id: "deploy:env",
		stepId: "deploy",
		kind: "envVars",
		title: "Runtime env vars",
		subtitle: safeTrim(deployment.envVars) ? "Injected into .env on EC2" : "None",
		action: "openEnvVars",
	});
	artifacts.push({
		id: "deploy:nginx",
		stepId: "deploy",
		kind: "nginx",
		title: "Reverse proxy (Nginx)",
		subtitle: safeTrim(scanResults?.nginx_conf) ? "Uses nginx.conf from scan results" : "Uses default proxy config",
		action: "openNginx",
	});

	// ── done ────────────────────────────────────────────────────────────────
	artifacts.push({
		id: "done:domain",
		stepId: "done",
		kind: "customDomain",
		title: "Custom domain / live URL",
		subtitle: safeTrim(deployment.liveUrl) ? safeTrim(deployment.liveUrl).replace(/^https?:\/\//, "") : "Not set",
		action: "openCustomDomain",
	});

	// ── warnings/invariants ────────────────────────────────────────────────
	if (!scanResults) {
		warnings.push({
			id: "no-scan-results",
			severity: "warning",
			title: "No scan results available",
			description: "Preview requires scan artifacts (Dockerfiles, nginx.conf, etc.). Run a scan first.",
			stepId: "build",
		});
	}

	if (scanResults && dockerfileCount < 1) {
		warnings.push({
			id: "missing-dockerfiles",
			severity: "warning",
			title: "No Dockerfiles available",
			description: "At least one Dockerfile is required to build an image.",
			stepId: "build",
			artifactId: "build:dockerfiles",
		});
	}

	if (composeBuildMode && scanResults) {
		for (const svc of services) {
			const path = safeTrim(svc.dockerfile_path);
			if (!path) {
				warnings.push({
					id: `compose-missing-dockerfile-path:${svc.name}`,
					severity: "warning",
					title: "Service missing Dockerfile path",
					description: `${svc.name} is part of the compose build, but has no dockerfile_path set.`,
					stepId: "build",
					artifactId: "build:compose",
				});
				continue;
			}
			if (!(scanResults.dockerfiles ?? {})[path]) {
				warnings.push({
					id: `compose-missing-dockerfile:${svc.name}`,
					severity: "warning",
					title: "Compose references missing Dockerfile",
					description: `${svc.name} expects ${path}, but that file isn't present in generated Dockerfiles.`,
					stepId: "build",
					artifactId: "build:compose",
				});
			}
		}
	}

	if (composeBuildMode && services.length <= 1) {
		warnings.push({
			id: "compose-without-multiservice",
			severity: "info",
			title: "Compose present but not multi-service",
			description: "Compose build mode only applies when multiple services are detected.",
			stepId: "build",
			artifactId: "build:compose",
		});
	}

	if (safeTrim(deployment.liveUrl) && !safeTrim(scanResults?.nginx_conf)) {
		warnings.push({
			id: "domain-without-nginx",
			severity: "info",
			title: "Domain set without explicit nginx routing",
			description: "A public URL exists, but nginx.conf is missing. The deployment will fall back to a default reverse proxy.",
			stepId: "deploy",
			artifactId: "deploy:nginx",
		});
	}

	return { steps, artifacts, warnings, composeBuildMode };
}

