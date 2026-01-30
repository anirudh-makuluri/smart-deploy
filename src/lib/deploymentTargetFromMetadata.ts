import type { AWSDeploymentTarget } from "@/app/types";
import type { AIGenProjectMetadata } from "@/app/types";

export type DeploymentAnalysisFromMetadata = {
	target: AWSDeploymentTarget;
	reason: string;
	warnings: string[];
};

const EB_SUPPORTED_LANGUAGES = ["node", "python", "java", "go", "dotnet", "php", "ruby"];

function normalizeLanguage(language: string | undefined, framework: string | undefined): string | null {
	if (!language) return null;
	const lang = language.toLowerCase().trim();
	if (lang === "typescript" || lang === "javascript" || lang === "node") return "node";
	if (lang === "python") return "python";
	if (lang === "java") return "java";
	if (lang === "go" || lang === "golang") return "go";
	if (lang === "c#" || lang === "csharp" || lang === ".net") return "dotnet";
	if (lang === "php") return "php";
	if (lang === "ruby") return "ruby";
	if (lang === "rust") return "rust";
	if (framework?.toLowerCase().includes("next")) return "node";
	return null;
}

function isNextJs(metadata: AIGenProjectMetadata): boolean {
	const f = metadata.core_deployment_info?.framework ?? "";
	return /next\.?js/i.test(f);
}

/**
 * Derives AWS deployment target from scan metadata (no filesystem).
 * Mirrors selectAWSDeploymentTarget logic for use after Smart Project Scan.
 */
export function selectDeploymentTargetFromMetadata(
	metadata: AIGenProjectMetadata | null | undefined
): DeploymentAnalysisFromMetadata | null {
	if (!metadata?.core_deployment_info || !metadata?.features_infrastructure) {
		return null;
	}
	const core = metadata.core_deployment_info;
	const features = metadata.features_infrastructure;
	const hints = metadata.deployment_hints ?? {};
	const warnings: string[] = [];
	const language = normalizeLanguage(core.language, core.framework);

	if (hints.is_multi_service) {
		return {
			target: "ecs",
			reason: "Multi-service app. ECS Fargate provides container orchestration for multiple services.",
			warnings,
		};
	}
	if (hints.has_database) {
		warnings.push("Database detected. AWS RDS can be provisioned.");
		return {
			target: "ecs",
			reason: "Application uses a database. ECS Fargate with RDS provides managed database connectivity.",
			warnings,
		};
	}
	if (features.uses_websockets) {
		return {
			target: "ecs",
			reason: "App uses WebSockets. ECS Fargate with ALB supports WebSocket connections.",
			warnings,
		};
	}
	if (language === "node" && !hints.has_dockerfile && core.build_cmd) {
		const nextStatic = isNextJs(metadata) && hints.nextjs_static_export;
		const notNext = !isNextJs(metadata);
		if (nextStatic || notNext) {
			return {
				target: "amplify",
				reason: "Frontend/static Node app. AWS Amplify Hosting for fast static deploys.",
				warnings,
			};
		}
	}
	if (language && EB_SUPPORTED_LANGUAGES.includes(language)) {
		if (hints.has_dockerfile) {
			warnings.push("Dockerfile detected. Using ECS for containerized deployment.");
			return {
				target: "ecs",
				reason: "Dockerfile present. ECS Fargate provides native container support.",
				warnings,
			};
		}
		if (language === "node" && isNextJs(metadata)) {
			return {
				target: "ecs",
				reason: "Next.js app. ECS Fargate is used for Next.js deployments.",
				warnings,
			};
		}
		return {
			target: "elastic-beanstalk",
			reason: `Simple ${language} app. Elastic Beanstalk for easy deployment and auto-scaling.`,
			warnings,
		};
	}
	if (hints.has_dockerfile) {
		return {
			target: "ecs",
			reason: "Dockerfile present. ECS Fargate will build and deploy the container.",
			warnings,
		};
	}
	if (language === "rust") {
		warnings.push("Rust is not supported by Elastic Beanstalk. A Dockerfile may be generated.");
		return {
			target: "ecs",
			reason: "Rust app requires containerization. ECS Fargate will handle the deployment.",
			warnings,
		};
	}
	if (!language) {
		warnings.push("Could not detect language. EC2 provides maximum flexibility.");
	}
	return {
		target: "ec2",
		reason: "Complex or unknown requirements. EC2 provides full control.",
		warnings,
	};
}
