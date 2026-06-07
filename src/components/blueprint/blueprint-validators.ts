import type { BlueprintValidationIssue } from "@/components/blueprint/blueprint-types";
import type { DeployConfig, ScanResultsPayload } from "@/app/types";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";

export function validateBlueprint(
	deployment: DeployConfig,
	scanResults: ScanResultsPayload | null
): BlueprintValidationIssue[] {
	if (!scanResults || !isSdArtifactsAnalyzeScan(scanResults)) return [];

	const issues: BlueprintValidationIssue[] = [];
	if (scanResults.build_status === "failed" || scanResults.build_status === "error") {
		issues.push({
			id: "analyze-build-failed",
			severity: "warning",
			title: "Analyze build did not pass",
			description: `Railpack build status is "${scanResults.build_status}". Review deploy briefing before deploying.`,
		});
	}
	for (const unit of scanResults.deploy_units) {
		if (!unit.artifacts?.railpack_plan && unit.type !== "existing_docker") {
			issues.push({
				id: `unit-${unit.name}-no-plan`,
				severity: "warning",
				title: `Missing Railpack plan for ${unit.name}`,
				description: "Re-run analyze or send feedback to generate a build plan for this unit.",
			});
		}
	}
	if (deployment.hostedSubdomain?.trim() && scanResults.deploy_shape === "server") {
		issues.push({
			id: "domain-server-routing",
			severity: "info",
			title: "Custom domain on server workload",
			description: "Ingress is configured at deploy time (ALB). Ensure the service port matches the analyze unit.",
		});
	}
	return issues;
}
