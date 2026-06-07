type DeployLogEntry = {
	timestamp?: string | null;
	message?: string | null;
};

export function formatRecentDeployLogs(
	entries: DeployLogEntry[] | null | undefined,
	maxEntries = 80,
	maxChars = 12000,
): string {
	return (entries ?? [])
		.slice(-maxEntries)
		.flatMap((entry) => {
			const line = `${entry.timestamp || ""} ${entry.message || ""}`.trim();
			return line ? [line] : [];
		})
		.join("\n")
		.slice(-maxChars);
}
