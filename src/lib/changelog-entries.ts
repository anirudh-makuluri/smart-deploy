/**
 * Site-facing changelog (newest first). Summaries avoid naming specific hosting vendors;
 * use the git log for exhaustive history.
 */
export type ChangelogEntry = {
	date: string;
	summary: string;
};

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
	{
		date: "April 12, 2026",
		summary:
			"Documentation: `/docs` renders the repository README and markdown guides from `docs/` with a minimal layout (no marketing cards).",
	},
	{
		date: "April 12, 2026",
		summary: "Landing page: copy and structure updates for the public marketing page.",
	},
	{
		date: "April 12, 2026",
		summary: "Merged backend fixes from pull request #8.",
	},
	{
		date: "April 12, 2026",
		summary: "Access control: added `approved_users` table for Supabase-backed sign-in allowlisting.",
	},
	{
		date: "April 12, 2026",
		summary: "Merged backend fixes from pull request #7.",
	},
	{
		date: "April 12, 2026",
		summary:
			"Operations: system health check API integrated with the WebSocket worker health endpoints so the app and worker report status consistently.",
	},
	{
		date: "April 12, 2026",
		summary: "WebSocket worker: authentication for connections and health-check behavior.",
	},
	{
		date: "April 12, 2026",
		summary: "WebSocket worker container: Dockerfile updates and bind address so the worker accepts remote connections in container setups.",
	},
	{
		date: "April 11, 2026",
		summary: "App container: simplified Dockerfile; GCP setup documentation refreshed for the Google Cloud CLI workflow.",
	},
	{
		date: "April 11, 2026",
		summary: "WebSocket worker: dedicated health endpoint and clearer status responses for readiness checks.",
	},
];
