import type { DeployConfig } from "@/app/types";

/** All deployments use sd-artifacts analyze (container kind). */
export function getDeploymentKind(_deployment: Pick<DeployConfig, "kind"> | null | undefined): "container" {
	return "container";
}

export function isDirectStaticDeployment(_deployment: Pick<DeployConfig, "kind"> | null | undefined): false {
	return false;
}
