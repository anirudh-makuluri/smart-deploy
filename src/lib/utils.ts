import { AIGenProjectMetadata, DeployConfig, DeploymentTarget } from "@/app/types";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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

	const timeFormatter = new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
		timeZoneName: 'short',
	});

	if (isSameDay) {
		return `Today at ${timeFormatter.format(date)}`;
	} else if (isYesterday) {
		return `Yesterday at ${timeFormatter.format(date)}`;
	} else {
		const dateFormatter = new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true,
			timeZoneName: 'short',
		});
		return dateFormatter.format(date);
	}
}

export function formatDeploymentTargetName(target: DeploymentTarget | undefined): string {
	if (!target) return "Unknown";
	
	const targetNames: Record<DeploymentTarget, string> = {
		'amplify': 'AWS Amplify',
		'elastic-beanstalk': 'AWS Elastic Beanstalk',
		'ecs': 'AWS ECS Fargate',
		'ec2': 'AWS EC2',
		'cloud-run': 'Google Cloud Run',
	};
	
	return targetNames[target] || target;
}

/** Sanitize a string for use as a DNS subdomain (lowercase, a-z0-9-, max 63 chars). Exported for Vercel DNS API. */
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

/** When using NEXT_PUBLIC_DEPLOYMENT_DOMAIN, this is the URL to point DNS to in Vercel (CNAME target). */
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
	.split(",")
	.map(pair => pair.trim())
	.filter(pair => pair.includes("="))
	.map(pair => {
		const [key, ...rest] = pair.split("=")
		return { name: key, value: rest.join("=") }
	})

	return result;
}

export function parseEnvVarsToStore(envString: string): string {
	return envString
		.split("\n")
		.map(line => line.trim())
		.filter(line => line && !line.startsWith("#"))
		.join(",");
}

/** Parse newline-separated .env-style content (e.g. paste or uploaded file) into key/value entries. */
export function parseEnvLinesToEntries(text: string): { name: string; value: string }[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) => {
			const eq = line.indexOf("=");
			if (eq === -1) return { name: line, value: "" };
			return { name: line.slice(0, eq).trim(), value: line.slice(eq + 1).trim() };
		})
		.filter((e) => e.name.length > 0);
}

/** Build env vars string from entries (newline-separated KEY=value) for form/deploy. */
export function buildEnvVarsString(entries: { name: string; value: string }[]): string {
	return entries
		.filter((e) => e.name.trim().length > 0)
		.map((e) => `${e.name.trim()}=${e.value}`)
		.join("\n");
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


export function extractDeployConfigFromAI(responseObj: { response: string }): AIGenProjectMetadata | null {
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

export function sanitizeAndParseAIResponse(raw: any): AIGenProjectMetadata | null {
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
	if (!config) return {};
	const { dockerfile, dockerfileInfo, dockerfileContent, ...rest } = config;
	return { ...rest } as Record<string, unknown>;
}

