import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { defaultAwsRegionForDeploy } from "@/lib/deployInfraDefaults";
import { shouldDeployStaticSiteToS3 } from "@/lib/deployRouting";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";

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
	/** Optional payload the UI can use (e.g. deploy unit name). */
	meta?: Record<string, string | number | boolean | null | undefined>;
};

export type PreviewStep = {
	id: PreviewStepId;
	label: string;
	description: string;
};

export type PreviewDeployRoute = "static_s3" | "ecs";

export type PreviewModel = {
	steps: PreviewStep[];
	artifacts: PreviewArtifact[];
	warnings: PreviewWarning[];
	/** True when analyze returned multiple deploy units. */
	composeBuildMode: boolean;
	/** Resolved from analyze + service name; null when analyze is missing. */
	deployRoute: PreviewDeployRoute | null;
	/** Short label for the preview header. */
	pipelineLabel: string;
};

function safeTrim(value: string | null | undefined) {
	return (value ?? "").trim();
}

export function buildPreviewModel(params: {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
}): PreviewModel {
	const { deployment, scanResults } = params;

	const isAnalyze = isSdArtifactsAnalyzeScan(scanResults);
	const units = isAnalyze ? scanResults.deploy_units : [];
	const composeBuildMode = isAnalyze && scanResults.deploy_shape === "multi" && units.length > 1;
	const unitCount = units.length;
	const deployRoute: PreviewDeployRoute | null = isAnalyze
		? shouldDeployStaticSiteToS3(scanResults, deployment.serviceName)
			? "static_s3"
			: "ecs"
		: null;
	const isStatic = deployRoute === "static_s3";

	const steps: PreviewStep[] = isStatic
		? [
				{
					id: "auth",
					label: "Auth & resolve ref",
					description: "Resolve branch/commit and authenticate to start a build.",
				},
				{
					id: "build",
					label: "Build & publish (CodeBuild)",
					description: "CodeBuild clones the repo, runs the static build (or syncs files), then uploads to S3.",
				},
				{
					id: "setup",
					label: "CDN & bucket",
					description: "Artifacts land in your static site bucket; CloudFront serves them publicly.",
				},
				{
					id: "deploy",
					label: "Invalidate cache",
					description: "Optional CloudFront invalidation so visitors see the latest build.",
				},
				{
					id: "done",
					label: "Public URL",
					description: "Site is available at your configured CloudFront or custom domain.",
				},
			]
		: [
				{
					id: "auth",
					label: "Auth & resolve ref",
					description: "Resolve branch/commit and authenticate to start a build.",
				},
				{
					id: "build",
					label: "Clone & build images (CodeBuild)",
					description: "CodeBuild clones the repo, runs Railpack or Dockerfile, then pushes images to ECR.",
				},
				{
					id: "setup",
					label: "ECS prerequisites",
					description: "Fargate task definition uses your cluster, subnets, security groups, and execution role.",
				},
				{
					id: "deploy",
					label: "ECS Fargate + ALB",
					description: "Register the service, wire the shared ALB host rule, and run the container.",
				},
				{
					id: "done",
					label: "Domain & routing",
					description: "Configure ALB host routing and Route 53 DNS for the custom domain.",
				},
			];

	const pipelineLabel = !isAnalyze
		? "Run Smart Analysis"
		: isStatic
			? "CodeBuild → S3 + CloudFront"
			: "CodeBuild → ECR → ECS Fargate";

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
	if (isAnalyze) {
		artifacts.push({
			id: "build:units",
			stepId: "build",
			kind: "dockerfiles",
			title: `Deploy unit${unitCount === 1 ? "" : "s"}`,
			subtitle: unitCount > 0 ? `${unitCount} · ${scanResults.deploy_shape}` : "Missing",
			action: "openDockerfile",
		});
	}

	const contexts = Array.from(new Set(units.map((u) => safeTrim(u.root)).filter(Boolean)));
	if (contexts.length > 0) {
		artifacts.push({
			id: "build:contexts",
			stepId: "build",
			kind: "buildContexts",
			title: "Build contexts",
			subtitle: contexts.length > 1 ? `${contexts.length} paths` : contexts[0],
		});
	}

	if (isStatic) {
		artifacts.push({
			id: "build:s3",
			stepId: "build",
			kind: "ecrOutput",
			title: "S3 output",
			subtitle: "Build artifacts synced to STATIC_SITE_BUCKET",
		});
	} else {
		artifacts.push({
			id: "build:ecr",
			stepId: "build",
			kind: "ecrOutput",
			title: "ECR output",
			subtitle: "Images are tagged and pushed for ECS deployment",
		});
	}

	// ── setup ───────────────────────────────────────────────────────────────
	artifacts.push({
		id: "setup:region",
		stepId: "setup",
		kind: "region",
		title: "Region",
		subtitle: safeTrim(deployment.awsRegion) || defaultAwsRegionForDeploy(),
		action: "openInfra",
	});
	if (isStatic) {
		artifacts.push({
			id: "setup:cdn",
			stepId: "setup",
			kind: "networking",
			title: "CloudFront",
			subtitle: "Served via STATIC_SITE_PUBLIC_BASE_URL",
		});
	} else {
		artifacts.push({
			id: "setup:fargate",
			stepId: "setup",
			kind: "networking",
			title: "Fargate networking",
			subtitle: "ECS cluster · subnets · security groups · execution role",
			action: "openInfra",
		});
	}

	// ── deploy ──────────────────────────────────────────────────────────────
	if (!isStatic) {
		artifacts.push({
			id: "deploy:env",
			stepId: "deploy",
			kind: "envVars",
			title: "Runtime env vars",
			subtitle: safeTrim(deployment.envVars) ? "Injected into the container" : "None",
			action: "openEnvVars",
		});
	}

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
	if (isAnalyze && unitCount < 1) {
		warnings.push({
			id: "missing-deploy-units",
			severity: "warning",
			title: "No deploy units available",
			description: "Analyze must return at least one deploy unit to build an image.",
			stepId: "build",
			artifactId: "build:units",
		});
	}

	if (isAnalyze) {
		const st = scanResults.build_status;
		if (st === "failed" || st === "error" || st === "not_run") {
			warnings.push({
				id: "analyze-build-status",
				severity: "warning",
				title: "Analyze build did not pass",
				description: `Railpack build status is "${st}". Review deploy briefing before deploying.`,
				stepId: "build",
			});
		}

		for (const unit of units) {
			if (!unit.artifacts?.railpack_plan && unit.type !== "existing_docker") {
				warnings.push({
					id: `unit-${unit.name}-no-plan`,
					severity: "warning",
					title: `Missing Railpack plan for ${unit.name}`,
					description: "Re-run analyze or send feedback to generate a build plan for this unit.",
					stepId: "build",
					artifactId: "build:units",
				});
			}
		}
	}

	if (composeBuildMode && units.length <= 1) {
		warnings.push({
			id: "multi-shape-single-unit",
			severity: "info",
			title: "Multi shape with one unit",
			description: "deploy_shape is multi but only one unit was returned.",
			stepId: "build",
		});
	}

	return { steps, artifacts, warnings, composeBuildMode, deployRoute, pipelineLabel };
}
