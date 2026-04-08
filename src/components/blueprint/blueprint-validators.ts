import type { BlueprintValidationIssue } from "@/components/blueprint/blueprint-types";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

function serviceNodeId(name: string) {
	return `service-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

export function validateBlueprint(
	deployment: DeployConfig,
	scanResults: SDArtifactsResponse | null
): BlueprintValidationIssue[] {
	if (!scanResults) return [];

	const issues: BlueprintValidationIssue[] = [];
	const services = scanResults.services ?? [];
	const seenPorts = new Map<number, string>();

	services.forEach((service) => {
		const nodeId = serviceNodeId(service.name);

		if (!service.dockerfile_path?.trim() || !scanResults.dockerfiles?.[service.dockerfile_path]) {
			issues.push({
				id: `${nodeId}-dockerfile`,
				nodeId,
				severity: "warning",
				title: "Missing Dockerfile mapping",
				description: `${service.name} does not currently point to a generated Dockerfile artifact.`,
			});
		}

		if (!service.build_context?.trim()) {
			issues.push({
				id: `${nodeId}-context`,
				nodeId,
				severity: "info",
				title: "Build context not explicit",
				description: `${service.name} is missing a clear build context. Using "." can work, but it is harder to reason about in monorepos.`,
			});
		}

		if (!Number.isFinite(service.port) || service.port <= 0) {
			issues.push({
				id: `${nodeId}-port`,
				nodeId,
				severity: "warning",
				title: "Port is missing or invalid",
				description: `${service.name} needs a valid runtime port so routing and health checks stay predictable.`,
			});
		} else {
			const seenBy = seenPorts.get(service.port);
			if (seenBy) {
				issues.push({
					id: `${nodeId}-duplicate-port`,
					nodeId,
					severity: "warning",
					title: "Port collision detected",
					description: `${service.name} and ${seenBy} both expose port ${service.port}.`,
				});
			} else {
				seenPorts.set(service.port, service.name);
			}
		}
	});

	if (services.length > 1 && !scanResults.docker_compose?.trim()) {
		issues.push({
			id: "compose-missing",
			severity: "info",
			title: "No compose artifact present",
			description: "This repo has multiple detected services, but no docker-compose file is part of the current deployment bundle.",
		});
	}

	if (deployment.liveUrl?.trim() && !scanResults.nginx_conf?.trim() && services.length > 0) {
		issues.push({
			id: "domain-without-nginx",
			severity: "info",
			title: "Public URL without visible ingress mapping",
			description: "A custom or live URL exists, but the current scan results do not include nginx routing details.",
		});
	}

	return issues;
}
