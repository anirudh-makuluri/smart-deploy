import type { SDArtifactsResponse } from "@/app/types";
import config from "@/config";
import { pickDeployUnitForBuild } from "@/lib/sdArtifactsBuildContext";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { getRailpackStartCommand } from "@/lib/sdArtifactsWorkload";

export function staticSiteDeployConfigured(): boolean {
	return Boolean(config.STATIC_SITE_BUCKET?.trim() && config.STATIC_SITE_PUBLIC_BASE_URL?.trim());
}

/**
 * Static hosting on S3 (+ optional CloudFront):
 * - `deploy_shape: static` (plain files)
 * - `deploy_shape: static_build` with no Railpack start command (build-only SPA)
 */
export function shouldDeployStaticSiteToS3(scan: unknown, serviceName?: string | null): boolean {
	if (!isSdArtifactsAnalyzeScan(scan)) return false;
	const s = scan as SDArtifactsResponse;
	const unit = pickDeployUnitForBuild(s, serviceName);
	if (!unit) return false;

	if (s.deploy_shape === "static") return true;

	if (s.deploy_shape === "static_build") {
		const start = getRailpackStartCommand(unit.artifacts?.railpack_plan);
		return !start?.trim();
	}

	return false;
}

/** Container workloads: CodeBuild → ECR → ECS Fargate. */
export function shouldDeployToEcs(scan: unknown, serviceName?: string | null): boolean {
	return isSdArtifactsAnalyzeScan(scan) && !shouldDeployStaticSiteToS3(scan, serviceName);
}

export function isExistingDockerUnit(scan: SDArtifactsResponse, serviceName?: string | null): boolean {
	if (scan.deploy_shape === "existing_docker") return true;
	const unit = pickDeployUnitForBuild(scan, serviceName);
	return unit?.type === "existing_docker";
}
