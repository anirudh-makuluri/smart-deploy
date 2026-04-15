function toHttpUrl(wsUrl: string) {
	return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

/** Converts NEXT_PUBLIC_WS_URL style values (https/wss/ws) to a ws: or wss: base URL. */
export function normalizePublicWsUrl(wsBase: string): string {
	const trimmed = wsBase.trim();
	const base = trimmed || "ws://localhost:4001";
	return base.replace(/^https?/, (p) => (p === "https" ? "wss" : "ws"));
}

/** Same origin path as deploy WebSocket clients: base URL plus `auth` query token. */
export function buildAuthenticatedWorkerWebSocketUrl(wsBase: string, token: string): string {
	const url = new URL(normalizePublicWsUrl(wsBase));
	url.searchParams.set("auth", token);
	return url.toString();
}

function normalizeHealthPath(pathname: string, healthPath: "/health" | "/healthz") {
	const trimmedPath = pathname.replace(/\/+$/, "");

	if (!trimmedPath || trimmedPath === "/") {
		return healthPath;
	}

	if (trimmedPath === "/ws") {
		return healthPath;
	}

	return trimmedPath;
}

export function buildWebSocketHealthUrl(wsUrl: string, healthPath: "/health" | "/healthz") {
	const url = new URL(toHttpUrl(wsUrl));
	url.pathname = normalizeHealthPath(url.pathname, healthPath);
	url.search = "";
	return url.toString();
}
