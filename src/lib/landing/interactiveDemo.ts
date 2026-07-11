export type DemoPhase = "idle" | "setup" | "scan" | "blueprint" | "deploy" | "complete";

export const DEMO_PHASE_ORDER: DemoPhase[] = ["setup", "scan", "blueprint", "deploy", "complete"];

export const DEPLOY_ANIMATION_MS = 3000;

export const DEPLOY_LOG_LINES = [
	{ id: 1, text: "[build] pulling base image...", tone: "default" as const },
	{ id: 2, text: "[build] layers cached", tone: "default" as const },
	{ id: 3, text: "[deploy] pushing to ECR...", tone: "default" as const },
	{ id: 4, text: "[deploy] updating ECS service...", tone: "default" as const },
	{ id: 5, text: "[deploy] health check passed", tone: "success" as const },
	{ id: 6, text: "[deploy] traffic shifted to new task", tone: "success" as const },
];

export function getDeployLogIndex(elapsedMs: number, totalMs: number, lineCount: number): number {
	if (lineCount <= 0) return 0;
	const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
	return Math.min(lineCount, Math.max(1, Math.ceil(progress * lineCount)));
}

export function getBackgroundPhase(phase: DemoPhase): "idle" | "scan" | "blueprint" | "deploy" | "complete" {
	if (phase === "idle" || phase === "setup") return "idle";
	return phase;
}
