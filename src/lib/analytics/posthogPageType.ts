/**
 * Low-cardinality route bucket for PostHog (avoid raw path explosion).
 */
export function posthogPageType(pathname: string): string {
	const path = pathname === "" ? "/" : pathname;
	if (path === "/") return "landing";
	if (path.startsWith("/docs")) return "docs";
	if (path.startsWith("/changelog")) return "changelog";
	if (path.startsWith("/auth")) return "auth";
	if (path.startsWith("/waiting-list")) return "waiting_list";
	if (path.startsWith("/home")) return "app_home";
	const parts = path.split("/").filter(Boolean);
	const reserved = new Set(["api", "_next", "docs", "home", "auth", "changelog", "waiting-list", "icon.svg"]);
	if (parts.length >= 2 && parts[0] && !reserved.has(parts[0])) {
		return "repo_workspace";
	}
	return "other";
}
