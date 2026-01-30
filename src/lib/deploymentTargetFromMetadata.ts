import type { AWSDeploymentTarget } from "@/app/types";
import type { AIGenProjectMetadata, ServiceCompatibility } from "@/app/types";

export type DeploymentAnalysisFromMetadata = {
	target: AWSDeploymentTarget;
	reason: string;
	warnings: string[];
};

/** Order of targets from simplest to most complex; first compatible wins. */
const SIMPLEST_FIRST: AWSDeploymentTarget[] = [
	"amplify",
	"elastic-beanstalk",
	"cloud-run",
	"ecs",
	"ec2",
];

function getCompatibilityKey(target: AWSDeploymentTarget): keyof ServiceCompatibility | null {
	if (target === "elastic-beanstalk") return "elastic_beanstalk";
	// if (target === "cloud-run") return "cloud_run";
	return target as keyof ServiceCompatibility;
}

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
 * Picks the simplest compatible target from LLM-reported service_compatibility.
 * Returns null if no compatibility data or no compatible target.
 */
function selectSimplestFromCompatibility(
	service_compatibility: ServiceCompatibility,
	warnings: string[]
): DeploymentAnalysisFromMetadata | null {
	const labels: Record<AWSDeploymentTarget, string> = {
		amplify: "AWS Amplify (static/frontend)",
		"elastic-beanstalk": "AWS Elastic Beanstalk",
		"cloud-run": "Google Cloud Run",
		ecs: "AWS ECS Fargate",
		ec2: "AWS EC2",
	};
	for (const target of SIMPLEST_FIRST) {
		const key = getCompatibilityKey(target);
		if (!key || service_compatibility[key] !== true) continue;
		return {
			target,
			reason: `Compatible with ${labels[target]}; chosen as the simplest option for this project.`,
			warnings,
		};
	}
	return null;
}

/**
 * Derives deployment target from scan metadata (no filesystem).
 * Uses LLM-reported service_compatibility to pick the simplest compatible platform when present;
 * otherwise falls back to rule-based logic.
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
	const compat = metadata.service_compatibility;

	// Prefer LLM-reported compatibility: pick simplest compatible target
	if (compat && typeof compat === "object") {
		// Check if all compatibility flags are false (mobile-only or no deployable code)
		const allFalse = Object.values(compat).every(v => v === false);
		if (allFalse) {
			// No compatible platform - this is mobile-only or has no deployable code
			return null;
		}
		const result = selectSimplestFromCompatibility(compat, warnings);
		if (result) return result;
		
		// Fallback: If LLM incorrectly marked amplify as false for a static SPA, fix it
		// Static SPAs (CRA, Vite, etc.) have build_cmd but no run_cmd
		// Check for common static SPA frameworks even if LLM incorrectly marked uses_server as true
		if (language === "node" && !hints.has_dockerfile && core.build_cmd && !core.run_cmd) {
			const isStaticSPA = 
				core.framework?.toLowerCase().includes("react") && !isNextJs(metadata) || // CRA, Vite React
				core.framework?.toLowerCase().includes("vite") ||
				core.framework?.toLowerCase().includes("angular") ||
				core.framework?.toLowerCase().includes("vue") ||
				core.framework?.toLowerCase().includes("svelte");
			const nextStatic = isNextJs(metadata) && hints.nextjs_static_export;
			if (isStaticSPA || nextStatic) {
				warnings.push("Detected static SPA. Using Amplify for optimal static hosting.");
				return {
					target: "amplify",
					reason: "Static frontend app (SPA). AWS Amplify Hosting is perfect for static sites like Create React App, Vite, and Next.js static exports.",
					warnings,
				};
			}
		}
	}

	// Fallback: rule-based selection (same order of checks as before)
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
	// Amplify for static SPAs: Node apps with build_cmd but no run_cmd (or run_cmd is null)
	// This includes: Create React App, Vite, Angular, Vue CLI, and Next.js static export
	if (language === "node" && !hints.has_dockerfile && core.build_cmd && !core.run_cmd) {
		const nextStatic = isNextJs(metadata) && hints.nextjs_static_export;
		const notNext = !isNextJs(metadata);
		if (nextStatic || notNext) {
			return {
				target: "amplify",
				reason: "Static frontend app (SPA). AWS Amplify Hosting is perfect for static sites like Create React App, Vite, and Next.js static exports.",
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
	// Check if this is mobile-only or has no deployable code
	if (features.uses_mobile && !features.uses_server && !core.run_cmd) {
		// Mobile-only app with no server code - not deployable
		return null;
	}
	if (!language && !core.run_cmd) {
		// No language and no run command - likely empty repo or docs-only
		return null;
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
