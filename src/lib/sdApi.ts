export function getSdApiBaseUrl(): string {
	return (process.env.SD_API_BASE_URL || "http://localhost:8080").trim().replace(/\/+$/, "");
}

export function getSdApiBearerToken(): string {
	return (process.env.SD_API_BEARER_TOKEN || "").trim();
}

export function getSdApiHeaders(extra?: HeadersInit): HeadersInit {
	const token = getSdApiBearerToken();
	if (!token) {
		throw new Error("Missing SD_API_BEARER_TOKEN");
	}

	return {
		Authorization: `Bearer ${token}`,
		...extra,
	};
}
