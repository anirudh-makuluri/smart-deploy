import type { SDArtifactsResponse, SDDeployUnit, SDRailpackPlan, SDRemoteBuild } from "../app/types";

/** BUILDKIT_SYNTAX image for Railpack (pin via `railpack_version` on analyze payload). */
export function railpackFrontendBuildkitSyntax(railpackVersion: string | null | undefined): string {
	const v = (railpackVersion || "").trim();
	const tag = v ? (v.startsWith("v") ? v : `v${v}`) : "latest";
	return `ghcr.io/railwayapp/railpack-frontend:${tag}`;
}

export function pickDeployUnitForBuild(
	scan: SDArtifactsResponse,
	preferredServiceName?: string | null
): SDDeployUnit | null {
	const units = scan.deploy_units;
	if (!units?.length) return null;
	const name = preferredServiceName?.trim();
	if (name) {
		const exact = units.find((u) => u.name === name);
		if (exact) return exact;
	}
	const withPlan = units.find(
		(u) => u.artifacts?.railpack_plan && Object.keys(u.artifacts.railpack_plan as object).length > 0
	);
	return withPlan ?? units[0];
}

export function encodeJsonForCodeBuildEnv(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function hasUsableRailpackPlan(plan: SDRailpackPlan | null | undefined): plan is SDRailpackPlan {
	return !!plan && typeof plan === "object" && Object.keys(plan).length > 0;
}

function normalizePackagePathForSdArtifacts(packagePath: string | null | undefined): string {
	const trimmed = (packagePath || ".").trim().replace(/\\/g, "/");
	const segments = trimmed
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0 && segment !== ".");
	return segments.length > 0 ? segments.join("/") : ".";
}

function sanitizeSdArtifactsRepoSegment(value: string, fallback: string): string {
	const lowered = [...value].map((ch) => (/[a-z0-9]/i.test(ch) ? ch.toLowerCase() : "-")).join("");
	const collapsed = lowered
		.split("-")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.join("-");
	const base = collapsed || fallback;
	const withPrefix = /^[a-z]/.test(base) ? base : `a-${base}`;
	return withPrefix.slice(0, 80).replace(/-+$/g, "") || fallback;
}

export function buildSdArtifactsRemoteBuildRepoName(repoName: string, packagePath?: string | null): string {
	const repoSlug = sanitizeSdArtifactsRepoSegment(repoName, "repo");
	const normalizedPath = normalizePackagePathForSdArtifacts(packagePath);
	const packageSegments = normalizedPath === "."
		? ["root"]
		: normalizedPath.split("/").map((segment) => sanitizeSdArtifactsRepoSegment(segment, "path"));
	return ["sd", repoSlug, ...packageSegments].join("/").slice(0, 256);
}

export function sdArtifactsRemoteBuildImageTag(commitSha: string | null | undefined): string {
	const raw = (commitSha || "unknown").slice(0, 6).toLowerCase();
	const filtered = [...raw].filter((ch) => /[a-z0-9._-]/.test(ch)).join("");
	return filtered || "unknown";
}

function normalizeRemoteBuildStatus(status: string | null | undefined): string {
	return (status || "").trim().toUpperCase();
}

export function pickRemoteBuildForDeployUnit(
	scan: SDArtifactsResponse,
	preferredServiceName?: string | null
): { unit: SDDeployUnit; remoteBuild: SDRemoteBuild } | null {
	const unit = pickDeployUnitForBuild(scan, preferredServiceName);
	if (!unit) return null;
	const remoteBuild = unit.remote_build ?? scan.remote_builds?.[unit.name];
	if (!remoteBuild) return null;
	if (normalizeRemoteBuildStatus(remoteBuild.status) !== "SUCCEEDED") return null;
	return { unit, remoteBuild };
}

export function resolveSdArtifactsPrebuiltImage(params: {
	scan: SDArtifactsResponse;
	repoName: string;
	preferredServiceName?: string | null;
}): {
	unit: SDDeployUnit;
	remoteBuild: SDRemoteBuild;
	ecrRepoName: string;
	imageTag: string;
	imageUri: string | null;
	imageDigest: string | null;
} | null {
	const picked = pickRemoteBuildForDeployUnit(params.scan, params.preferredServiceName);
	if (!picked) return null;
	const { unit, remoteBuild } = picked;
	const ecrRepoName =
		remoteBuild.ecr_repository?.trim() ||
		buildSdArtifactsRemoteBuildRepoName(params.repoName, remoteBuild.unit_root || unit.root || params.scan.package_path);
	const imageTag =
		remoteBuild.image_tag?.trim() ||
		sdArtifactsRemoteBuildImageTag(params.scan.commit_sha);
	return {
		unit,
		remoteBuild,
		ecrRepoName,
		imageTag,
		imageUri: remoteBuild.image_uri?.trim() || null,
		imageDigest: remoteBuild.image_digest?.trim() || null,
	};
}
