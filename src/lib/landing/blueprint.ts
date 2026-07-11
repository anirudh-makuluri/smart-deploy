export type BlueprintStageId = "resolve" | "build" | "provision" | "deploy" | "publish";

export type BlueprintStageStatus = "pending" | "active" | "ok";

export type BlueprintStage = {
	id: BlueprintStageId;
	kicker: string;
	label: string;
	detail: string;
};

export const BLUEPRINT_STAGES: ReadonlyArray<BlueprintStage> = [
	{ id: "resolve", kicker: "source", label: "Resolve ref", detail: "Commit + service scope" },
	{ id: "build", kicker: "codebuild", label: "Build images", detail: "Railpack → ECR" },
	{ id: "provision", kicker: "infra", label: "Provision infra", detail: "ECS task + target group" },
	{ id: "deploy", kicker: "rollout", label: "Deploy + route", detail: "ALB host routing" },
	{ id: "publish", kicker: "domain", label: "Publish domain", detail: "Route 53 + TLS" },
];

export const BLUEPRINT_STAGE_COUNT = BLUEPRINT_STAGES.length;

/** Milliseconds between each stage resolving to `ok` while the pipeline draws. */
export const BLUEPRINT_STAGE_STEP_MS = 360;

/**
 * Derives a stage's status from how many stages have resolved so far.
 * The stage currently resolving is `active`; earlier stages are `ok`.
 */
export function getBlueprintStageStatus(
	stageIndex: number,
	resolvedCount: number
): BlueprintStageStatus {
	if (stageIndex < resolvedCount) return "ok";
	if (stageIndex === resolvedCount) return "active";
	return "pending";
}

export function isBlueprintComplete(resolvedCount: number): boolean {
	return resolvedCount >= BLUEPRINT_STAGE_COUNT;
}
