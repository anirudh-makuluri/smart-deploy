import type { DeploymentTarget, DeployConfig } from "@/app/types";
import type { AIGenProjectMetadata, ServiceCompatibility } from "@/app/types";

/**
 * Returns true when this deployment cannot be deployed (mobile-only, library, no deployable code, or no compatible platform).
 * Use to disable the deploy button and hide the deployment target UI.
 */
export function isDeploymentDisabled(deployment: DeployConfig | null | undefined): boolean {
	if (!deployment) return false;
	const fi = deployment.features_infrastructure;
	const core = deployment.core_deployment_info;
	if (fi?.uses_mobile && !fi?.uses_server && !core?.run_cmd) return true;
	if (fi?.is_library) return true;
	if (!core?.language && !core?.run_cmd) return true;
	return false;
}
