import type { DeployConfig, SDArtifactsResponse, SDDeployUnit, SDRailpackPlan } from "../../app/types";
import config from "../../config";
import { isSdArtifactsAnalyzeScan } from "../scanResultNormalization";
import { pickDeployUnitForBuild } from "../sdArtifactsBuildContext";
import { getRailpackStartCommand } from "../sdArtifactsWorkload";
import {
	ensureCodeBuildProject,
	ensureCodeBuildRole,
	startBuild,
	waitForBuildAndStreamLogs,
} from "./codebuildHelpers";

type SendFn = (msg: string, stepId: string) => void;

export async function runStaticSiteCodeBuildPipeline(params: {
	region: string;
	deployConfig: DeployConfig;
	repoFullName: string;
	branch: string;
	commitSha?: string;
	token: string;
	envVarsBase64?: string;
	dockerHub?: { username: string; token: string };
	send: SendFn;
}): Promise<{ success: boolean }> {
	const { region, deployConfig, repoFullName, branch, commitSha, token, envVarsBase64, dockerHub, send } = params;
	const scan = deployConfig.scanResults as SDArtifactsResponse;
	const unit = pickDeployUnitForBuild(scan, deployConfig.serviceName);
	if (!unit) throw new Error("Static site deploy requires a deploy unit in scan results.");
	if (!staticSiteDeployConfigured()) {
		throw new Error("Static site deploy requires STATIC_SITE_BUCKET and STATIC_SITE_PUBLIC_BASE_URL.");
	}

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "app";
	const prefix = buildStaticSiteS3Prefix(repoName, deployConfig.serviceName).replace(/^\/+/, "");
	const bucket = config.STATIC_SITE_BUCKET!.trim();
	const s3Uri = `s3://${bucket}/${prefix}`;
	const cmds = collectStaticBuildShellCommands(scan, unit);
	if (!cmds.length) {
		throw new Error(
			"static_build deploy has no shell commands. Re-run analyze or add install/build steps to the scan payload."
		);
	}
	const outputRel = pickStaticSiteOutputDirRelative(unit, scan);
	const ctx = unit.root || ".";

	const buildspec = generateStaticSiteBuildspec({
		region,
		contextRelative: ctx,
		shellCommands: cmds,
		outputDirRelative: outputRel,
		s3Uri,
		cloudFrontDistributionId: config.STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID?.trim() || null,
	});

	const roleArn = await ensureCodeBuildRole(region, send);
	const projectName = await ensureCodeBuildProject(region, roleArn, send);
	const buildId = await startBuild({
		region,
		projectName,
		repoFullName,
		branch,
		commitSha,
		githubToken: token,
		buildspec,
		envVarsBase64,
		dockerHub,
		send,
	});
	return waitForBuildAndStreamLogs({ buildId, region, send });
}function yamlListEntry(line: string, spaces: number): string {
	return " ".repeat(spaces) + "- " + JSON.stringify(line);
}

export function staticSiteDeployConfigured(): boolean {
	return Boolean(config.STATIC_SITE_BUCKET?.trim() && config.STATIC_SITE_PUBLIC_BASE_URL?.trim());
}

/**
 * `deploy_shape: static_build` with no Railpack start command → build output only; host on S3 (+ optional CloudFront).
 */
export function shouldDeployStaticSiteToS3(scan: unknown, serviceName?: string | null): boolean {
	if (!isSdArtifactsAnalyzeScan(scan)) return false;
	const s = scan as SDArtifactsResponse;
	if (s.deploy_shape !== "static_build") return false;
	const unit = pickDeployUnitForBuild(s, serviceName);
	if (!unit) return false;
	const start = getRailpackStartCommand(unit.artifacts?.railpack_plan);
	return !start?.trim();
}

export function buildStaticSiteS3Prefix(repoName: string, serviceName: string | undefined | null): string {
	const svc = (serviceName || "app").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "app";
	const base = (config.STATIC_SITE_KEY_PREFIX || "").trim().replace(/^\/+|\/+$/g, "");
	if (base) return `${base.replace(/\/$/, "")}/${svc}/`;
	return `${repoName.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase()}/${svc}/`;
}

function parseStringArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

export function railpackPlanStepShellCommands(plan: SDRailpackPlan | null | undefined): string[] {
	if (!plan?.steps?.length) return [];
	const out: string[] = [];
	for (const step of plan.steps) {
		for (const c of step.commands || []) {
			const cmd = typeof c.cmd === "string" ? c.cmd.trim() : "";
			if (cmd) out.push(cmd);
		}
	}
	return out;
}

export function collectStaticBuildShellCommands(scan: SDArtifactsResponse, unit: SDDeployUnit): string[] {
	const fromPlan = railpackPlanStepShellCommands(unit.artifacts?.railpack_plan ?? undefined);
	if (fromPlan.length) return fromPlan;
	const install = parseStringArray(scan.install);
	const build = parseStringArray(scan.build);
	return [...install, ...build];
}

export function pickStaticSiteOutputDirRelative(unit: SDDeployUnit, scan: SDArtifactsResponse): string {
	const top = typeof scan.output_dir === "string" ? scan.output_dir.trim() : "";
	if (top) return top.replace(/^\/+/, "").replace(/\\/g, "/");
	const fw = (unit.framework || "").toLowerCase();
	if (fw.includes("next")) return "out";
	if (fw.includes("nuxt")) return ".output/public";
	if (fw.includes("astro")) return "dist";
	if (fw.includes("svelte")) return "build";
	if (fw.includes("angular")) return "dist/browser";
	return "dist";
}

export function generateStaticSiteBuildspec(params: {
	region: string;
	contextRelative: string;
	shellCommands: string[];
	outputDirRelative: string;
	s3Uri: string;
	cloudFrontDistributionId?: string | null;
}): string {
	const ctx = (params.contextRelative || ".").replace(/\\/g, "/").trim() || ".";
	if (ctx !== "." && !/^[a-zA-Z0-9._\-/]+$/.test(ctx)) {
		throw new Error(`Unsafe static site context path: ${ctx}`);
	}
	const outRel = params.outputDirRelative.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!outRel || outRel.includes("..")) {
		throw new Error(`Invalid static output directory: ${params.outputDirRelative}`);
	}
	const s3Uri = params.s3Uri.replace(/\s+/g, "").replace(/\/+$/, "") + "/";
	const cfId = params.cloudFrontDistributionId?.trim();

	const preBuildCmds: string[] = [
		"echo Preparing static site build (clone + install/build)...",
		'if [ -n "$DOCKERHUB_USERNAME" ] && [ -n "$DOCKERHUB_TOKEN" ]; then echo "Logging in to Docker Hub..."; echo "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin; fi',
		"echo Cloning source repository...",
		"git clone -b $BRANCH_NAME https://${GITHUB_TOKEN}@github.com/${REPO_FULL_NAME}.git src",
		"cd src",
		'if [ -n "$COMMIT_SHA" ]; then git checkout $COMMIT_SHA; fi',
		'if [ -n "$APP_ENV_VARS_B64" ]; then echo "$APP_ENV_VARS_B64" | base64 -d > .env; fi',
	];
	if (ctx !== ".") {
		preBuildCmds.push(`cd ${JSON.stringify(ctx)}`);
	}

	const buildCmds: string[] = ["echo Running install/build commands..."];
	for (const cmd of params.shellCommands) {
		buildCmds.push(cmd);
	}

	const postBuildCmds: string[] = [
		`echo Syncing ${JSON.stringify(outRel)} to S3...`,
		`aws s3 sync ${JSON.stringify(outRel)} ${JSON.stringify(s3Uri)} --delete`,
	];
	if (cfId) {
		postBuildCmds.push(
			`aws cloudfront create-invalidation --distribution-id ${JSON.stringify(cfId)} --paths ${JSON.stringify("/*")}`
		);
	} else {
		postBuildCmds.push('echo "CloudFront invalidation skipped (STATIC_SITE_CLOUDFRONT_DISTRIBUTION_ID unset)."');
	}

	const SP = 6;
	const lines = [
		"version: 0.2",
		"phases:",
		"  pre_build:",
		"    commands:",
		...preBuildCmds.map((c) => yamlListEntry(c, SP)),
		"  build:",
		"    commands:",
		...buildCmds.map((c) => yamlListEntry(c, SP)),
		"  post_build:",
		"    commands:",
		...postBuildCmds.map((c) => yamlListEntry(c, SP)),
	];
	return lines.join("\n") + "\n";
}
