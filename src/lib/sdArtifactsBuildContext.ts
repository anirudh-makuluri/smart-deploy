import type { SDArtifactsResponse, SDDeployUnit, SDRailpackPlan } from "../app/types";

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
