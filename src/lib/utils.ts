import { DeployConfig, DeploymentTarget, RepoServicesRecord, SDArtifactsResponse } from "@/app/types";
import { sanitizeDeployConfigForHistory } from "@/lib/deploymentReleaseArtifacts";
import { getDeploymentStatusRank, isDraftDeploymentStatus } from "@/lib/deploymentStatus";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
	timeZoneName: "short",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
	timeZoneName: "short",
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}


export function formatTimestamp(isoString: string | undefined): string {
	if (!isoString) {
		return "Never";
	}

	const date = new Date(isoString);
	const now = new Date();

	// Use user's timezone automatically via Intl.DateTimeFormat
	const isSameDay = date.toDateString() === now.toDateString();

	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	const isYesterday = date.toDateString() === yesterday.toDateString();

	if (isSameDay) {
		return `Today at ${TIME_FORMATTER.format(date)}`;
	} else if (isYesterday) {
		return `Yesterday at ${TIME_FORMATTER.format(date)}`;
	} else {
		return DATE_TIME_FORMATTER.format(date);
	}
}

export function formatDeploymentTargetName(target: DeploymentTarget | undefined): string {
	if (!target) return "Unknown";

	const targetNames: Record<DeploymentTarget, string> = {
		ec2: "AWS EC2",
		ecs: "AWS ECS (Fargate)",
		static_s3: "Static site (S3 / CDN)",
		cloud_run: "Google Cloud Run",
	};

	return targetNames[target] || target;
}

/** Sanitize a string for use as a DNS subdomain (lowercase, a-z0-9-, max 63 chars). */
export function sanitizeSubdomain(s: string): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

const deploymentDomain = () =>
	(typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN?.trim()) || "";

/** URL to show for "Visit" / "Open link". Prefers stored custom_url; else *.NEXT_PUBLIC_DEPLOYMENT_DOMAIN when set; else deployUrl. */
export function getDeploymentDisplayUrl(d: { deployUrl?: string | null; custom_url?: string | null; service_name?: string; id?: string }): string | undefined {
	const custom = (d.custom_url ?? "").trim();
	if (custom) return custom;
	const base = deploymentDomain();
	if (base) {
		const sub = sanitizeSubdomain((d.service_name ?? d.id ?? "app").toString());
		return `https://${sub}.${base.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
	}
	return d.deployUrl ?? undefined;
}

/** When using NEXT_PUBLIC_DEPLOYMENT_DOMAIN, returns the deploy target host for Route 53 alias/CNAME. */
export function getDeploymentDnsTarget(d: { deployUrl?: string | null }): string | undefined {
	if (!deploymentDomain()) return undefined;
	const url = d.deployUrl?.trim();
	if (!url) return undefined;
	// Return host only for CNAME (user can copy or use as target)
	try {
		const u = new URL(url.startsWith("http") ? url : `https://${url}`);
		return u.hostname;
	} catch {
		return url;
	}
}


export function parseEnvVarsToDisplay(envVarsString: string = "") {
	const result = envVarsString
		.split(/\r?\n/)
		.map(pair => pair.trim())
		.filter(pair => pair.includes("="))
		.map(pair => {
			const [key, ...rest] = pair.split("=")
			return { name: key, value: rest.join("=") }
		})

	return result;
}

/** Legacy helper, converted to use newlines for consistency. */
export function parseEnvVarsToStore(envString: string): string {
	return envString
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line && !line.startsWith("#"))
		.join("\n");
}

/** Parse newline-separated .env-style content (e.g. paste or uploaded file) into key/value entries. */
export function parseEnvLinesToEntries(text: string): { name: string; value: string }[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const eq = line.indexOf("=");
			if (eq === -1) return { name: line, value: "" };
			return { name: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
		})
		.filter((e) => e.name.length > 0);
}

/** Build env vars string from entries (newline-separated KEY=value) for form/deploy. */
export function buildEnvVarsString(entries: { name: string; value: string }[]): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const name = entry.name.trim();
		if (name.length > 0) {
			lines.push(`${name}=${entry.value}`);
		}
	}
	return lines.join("\n");
}

export function readDockerfile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => {
			resolve(reader.result as string);
		};

		reader.onerror = () => {
			reject(reader.error);
		};

		reader.readAsText(file); // 👈 Reads as plain UTF-8 text
	});
}


export function formatLogTimestamp(isoTimestamp: string) {
	const date = new Date(isoTimestamp);

	// Format: DD MMM YYYY, hh:mm AM/PM
	return date.toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: true,
	});
}


export function extractDeployConfigFromAI(responseObj: { response: string }): SDArtifactsResponse | null {
	try {
		const cleaned = responseObj.response.replace(/\/\/.*$/gm, "").trim();

		// Parse the cleaned string
		const config = JSON.parse(cleaned);

		return config;
	} catch (error) {
		console.error("Failed to parse AI response:", error);
		return null;
	}
}

export function sanitizeAndParseAIResponse(raw: any): SDArtifactsResponse | null {
	try {
		let jsonStr = "";

		// Step 1: If the AI returned { response: "..." }, extract it
		if (typeof raw === "object" && typeof raw.response === "string") {
			jsonStr = raw.response;
		} else if (typeof raw === "string") {
			jsonStr = raw;
		} else {
			jsonStr = JSON.stringify(raw);
		}

		// Step 2: Remove comments (// ...)
		jsonStr = jsonStr.replace(/\/\/.*$/gm, "");

		// Step 3: Remove trailing commas before closing brackets/braces
		jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

		// Step 4: Trim non-JSON content (attempt to isolate the first valid object)
		const firstBrace = jsonStr.indexOf("{");
		const lastBrace = jsonStr.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found");

		const possibleJson = jsonStr.slice(firstBrace, lastBrace + 1);

		// Step 5: Parse
		return JSON.parse(possibleJson);

	} catch (err) {
		console.error("❌ Failed to sanitize/parse AI response:", err);
		return null;
	}
}

/** Build a serializable config snapshot for deployment history (no File/binary). */
export function configSnapshotFromDeployConfig(config: DeployConfig | null): Record<string, unknown> {
	return sanitizeDeployConfigForHistory(config);
}


export function normalizeRepoUrl(url: string): string {
	return url?.replace(/\.git$/, "").toLowerCase();
}

export function getDeploymentForService(
	deployments: DeployConfig[],
	repoUrl: string,
	serviceName: string,
	repoName: string
): DeployConfig | undefined {
	const matches: DeployConfig[] = [];

	for (const d of deployments) {
		if (d.repoName !== repoName && normalizeRepoUrl(d.url) !== normalizeRepoUrl(repoUrl)) continue;

		const dbServiceName = d.serviceName || "";
		const isExactHit = dbServiceName.toLowerCase() === serviceName.toLowerCase();
		const isRepoLevel = dbServiceName === "." || dbServiceName.toLowerCase() === repoName.toLowerCase();

		if (isExactHit || isRepoLevel) {
			matches.push(d);
		}
	}

	if (matches.length === 0) return undefined;

	return matches.toSorted((a, b) => {
		const statusRankA = getDeploymentStatusRank(a.status);
		const statusRankB = getDeploymentStatusRank(b.status);
		const statusDelta = statusRankB - statusRankA;
		if (statusDelta !== 0) return statusDelta;
		const aTime = new Date(a.lastDeployment ?? 0).getTime();
		const bTime = new Date(b.lastDeployment ?? 0).getTime();
		return bTime - aTime;
	})[0];
}

export function countDeployedServicesForRepo(
	repoRecord: Pick<RepoServicesRecord, "repo_url" | "repo_name" | "services">,
	deployments: DeployConfig[]
): number {
	const services = repoRecord.services ?? [];
	if (services.length === 0) return 0;

	return services.reduce((count, svc) => {
		const deployment = getDeploymentForService(
			deployments,
			repoRecord.repo_url,
			svc.name,
			repoRecord.repo_name
		);
		return deployment && !isDraftDeploymentStatus(deployment.status) ? count + 1 : count;
	}, 0);
}

export function isDeploymentDisabled(deployment: DeployConfig): boolean {
	if (!deployment) return true;

	const scanResults = deployment.scanResults;
	if (isSdArtifactsAnalyzeScan(scanResults)) {
		const st = scanResults.build_status;
		if (st === "failed" || st === "error" || st === "not_run") return true;
		return !scanResults.deploy_units?.length;
	}

	return true;
}
