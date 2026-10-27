export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonErrorMessage(payload: unknown, fallback: string): string {
	if (!isJsonObject(payload)) return fallback;
	for (const key of ["error", "details", "message"]) {
		const value = payload[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	if (Array.isArray(payload.errors)) {
		const first: unknown = payload.errors[0];
		if (isJsonObject(first) && typeof first.message === "string" && first.message.trim()) return first.message;
	}
	return fallback;
}

export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
	const payload: unknown = await response.json().catch(() => null);
	return jsonErrorMessage(payload, fallback);
}
