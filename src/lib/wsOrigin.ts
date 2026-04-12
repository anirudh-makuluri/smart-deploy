function normalizeOrigin(origin: string) {
	return origin.trim().replace(/\/+$/, "");
}

export function parseAllowedOrigins(rawOrigins: string | undefined) {
	if (!rawOrigins) {
		return [];
	}

	return rawOrigins
		.split(",")
		.map((origin) => normalizeOrigin(origin))
		.filter(Boolean);
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
	if (allowedOrigins.length === 0) {
		return true;
	}

	if (!origin) {
		return false;
	}

	return allowedOrigins.includes(normalizeOrigin(origin));
}

export function getAllowedOriginHeader(origin: string | undefined, allowedOrigins: string[]) {
	if (!origin) {
		return null;
	}

	if (!isOriginAllowed(origin, allowedOrigins)) {
		return null;
	}

	return normalizeOrigin(origin);
}
