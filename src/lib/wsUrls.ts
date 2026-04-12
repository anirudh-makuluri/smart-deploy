function toHttpUrl(wsUrl: string) {
	return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
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
