import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

export function getDeploymentKind(deployment: Pick<DeployConfig, "kind"> | null | undefined) {
	return deployment?.kind === "direct-static" ? "direct-static" : "container";
}

export function isDirectStaticDeployment(deployment: Pick<DeployConfig, "kind"> | null | undefined) {
	return getDeploymentKind(deployment) === "direct-static";
}

export function isDirectStaticScanResults(value: SDArtifactsResponse | Record<string, never> | null | undefined) {
	if (!value || typeof value !== "object") return false;
	return typeof value.serviceType === "string" && typeof value.output_dir === "string";
}

export function directStaticCommandList(value: string[] | undefined): string {
	return (value ?? []).join(" && ");
}

export function parseDirectStaticCommandList(value: string): string[] {
	return value
		.split(/\s*&&\s*/)
		.map((part) => part.trim())
		.filter(Boolean);
}
