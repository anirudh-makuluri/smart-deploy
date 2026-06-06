import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { DEFAULT_EC2_INSTANCE_TYPE } from "@/lib/aws/ec2InstanceTypes";
import { defaultAwsRegionForDeploy } from "@/lib/deployInfraDefaults";
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

export type PreviewModel = {
	steps: PreviewStep[];
	artifacts: PreviewArtifact[];
	warnings: PreviewWarning[];
	/** True when analyze returned multiple deploy units. */
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
			description: "CodeBuild clones the repo, runs Railpack, then builds images and pushes to ECR.",
		},
		{
			id: "setup",
			label: "Infra setup (VPC, key, security)",
			description: "Prepare networking, instance permissions, and prerequisites for EC2.",
		},
		{
			id: "deploy",
			label: "Deploy to EC2 (SSM) + reverse proxy",
			description: "Launch/reuse EC2, deploy containers, and configure routing.",
		},
		{
			id: "done",
			label: "Domain & routing",
			description: "Configure ALB host routing and optional DNS to make the deployment reachable.",
		},
	];

	const isAnalyze = isSdArtifactsAnalyzeScan(scanResults);
	const units = isAnalyze ? scanResults.deploy_units : [];
	const composeBuildMode = isAnalyze && scanResults.deploy_shape === "multi" && units.length > 1;
	const unitCount = units.length;

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
	if (!scanResults || !isAnalyze) {
		warnings.push({
			id: "no-scan-results",
			severity: "warning",
			title: "No analyze results available",
			description: "Preview requires sd-artifacts analyze output. Run a scan first.",
			stepId: "build",
		});
	}

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

	return { steps, artifacts, warnings, composeBuildMode };
}
