export function formatStructuredError(value: unknown): string {
	if (value == null) return "Unknown error";
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map((item) => formatStructuredError(item)).join(" | ");
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const code = typeof record.code === "string" ? `[${record.code}] ` : "";
		const message = typeof record.message === "string" ? record.message : "";
		const issues = Array.isArray(record.issues)
			? record.issues.map((issue) => `- ${formatStructuredError(issue)}`).join("\n")
			: "";
		const summary = `${code}${message}`.trim();
		if (summary && issues) return `${summary}\n${issues}`;
		if (summary) return summary;
		if (issues) return issues;
		try {
			return JSON.stringify(record);
		} catch {
			return String(value);
		}
	}
	return String(value);
}
