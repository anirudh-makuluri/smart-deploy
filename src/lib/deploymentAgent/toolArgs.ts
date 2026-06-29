import { TOOL_HISTORY_LOG_LIMIT } from "@/lib/deploymentAgent/constants";

export function summarizeLogs(logs: string[]): string[] {
	return logs
		.map((line) => String(line || "").trim())
		.filter((line) => line.length > 0)
		.slice(-TOOL_HISTORY_LOG_LIMIT);
}

export function normalizeToolArguments(args: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
	);
}

export function parseRequiredStringArg(
	args: Record<string, unknown>,
	key: "repoName" | "serviceName"
): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Tool argument \`${key}\` is required`);
	}
	return value.trim();
}

export function parseLimitArg(args: Record<string, unknown>, key: "limit", fallback: number): number {
	const rawValue = args[key];
	if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
		return Math.min(Math.max(Math.trunc(rawValue), 1), 10);
	}
	if (typeof rawValue === "string" && rawValue.trim().length > 0) {
		const parsed = Number(rawValue.trim());
		if (Number.isFinite(parsed)) {
			return Math.min(Math.max(Math.trunc(parsed), 1), 10);
		}
	}
	return fallback;
}