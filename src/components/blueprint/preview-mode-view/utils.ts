import type {
	PreviewArtifact,
	PreviewDeployRoute,
	PreviewStepId,
	PreviewWarning,
} from "@/components/blueprint/preview-model";
import config from "@/config.client";
import type { Editor } from "@/components/blueprint/preview-mode-view/types";
import { hostedUrlFromSubdomain, normalizeHostedSubdomain } from "@/lib/hostedUrl";

export const DOMAIN_SUFFIX = config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz";

export function mapCustomDomainError(error: unknown): string {
	const message = error instanceof Error ? error.message : "Failed to update custom domain";
	if (message === "Deployment not found") {
		return "This deployment no longer exists. Reopen the service or deploy again before setting a custom domain.";
	}
	return message;
}

export function groupByStep(artifacts: PreviewArtifact[]): Record<PreviewStepId, PreviewArtifact[]> {
	return artifacts.reduce(
		(acc, a) => {
			acc[a.stepId].push(a);
			return acc;
		},
		{ auth: [], build: [], setup: [], deploy: [], done: [] } as Record<PreviewStepId, PreviewArtifact[]>
	);
}

export function groupWarningsByStep(warnings: PreviewWarning[]): Record<PreviewStepId, PreviewWarning[]> {
	return warnings.reduce(
		(acc, w) => {
			acc[w.stepId].push(w);
			return acc;
		},
		{ auth: [], build: [], setup: [], deploy: [], done: [] } as Record<PreviewStepId, PreviewWarning[]>
	);
}

export function savedHostedSubdomain(hostedSubdomain: string | null | undefined): string {
	return normalizeHostedSubdomain(hostedSubdomain);
}

export function getHostedUrlFromSubdomain(subdomain: string): string {
	return hostedUrlFromSubdomain(subdomain) ?? "";
}

export function getNodeVerb(stepId: PreviewStepId, deployRoute: PreviewDeployRoute | null): string {
	if (stepId === "auth") return "Resolve ref";
	if (stepId === "build") {
		return deployRoute === "static_s3" ? "Build & sync" : "Build images";
	}
	if (stepId === "setup") {
		return deployRoute === "static_s3" ? "CDN + bucket" : "ECS prep";
	}
	if (stepId === "deploy") {
		return deployRoute === "static_s3" ? "Invalidate" : "Run service";
	}
	return "Publish URL";
}

export function getPreferredArtifactForStep(
	stepId: PreviewStepId,
	stepArtifacts: PreviewArtifact[]
): PreviewArtifact | undefined {
	if (stepId === "auth") {
		return stepArtifacts.find((a) => a.action === "openBranch");
	}
	if (stepId === "build") {
		return (
			stepArtifacts.find((a) => a.action === "openCompose") ??
			stepArtifacts.find((a) => a.action === "openDockerfile")
		);
	}
	if (stepId === "setup") {
		return stepArtifacts.find((a) => a.action === "openInfra");
	}
	if (stepId === "deploy") {
		return (
			stepArtifacts.find((a) => a.action === "openEnvVars") ??
			stepArtifacts.find((a) => a.action === "openNginx")
		);
	}
	return stepArtifacts.find((a) => a.action === "openCustomDomain");
}

export function getEditorTitle(editor: Editor): string {
	if (editor?.kind === "branch") return "Branch";
	if (editor?.kind === "dockerfile") return "Railpack plan";
	if (editor?.kind === "compose") return "Deploy units";
	if (editor?.kind === "infra") return "Infrastructure";
	if (editor?.kind === "envVars") return "Environment variables";
	if (editor?.kind === "nginx") return "Nginx";
	if (editor?.kind === "customDomain") return "Hosted subdomain";
	return "Details";
}

export function getEditorDescription(editor: Editor): string {
	if (editor?.kind === "customDomain") {
		return "Choose a subdomain on our host, or clear it to remove the hosted URL.";
	}
	return "Edits here update the deployment configuration or scan artifacts.";
}
