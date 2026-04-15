export const AUTH_LAST_METHOD_KEY = "smart-deploy.auth.lastMethod" as const;

export type AuthLastMethod = "google" | "github" | "email";

export function readLastAuthMethod(): AuthLastMethod | null {
	if (typeof window === "undefined") return null;
	try {
		const v = localStorage.getItem(AUTH_LAST_METHOD_KEY);
		if (v === "google" || v === "github" || v === "email") return v;
		return null;
	} catch {
		return null;
	}
}

export function writeLastAuthMethod(method: AuthLastMethod): void {
	try {
		localStorage.setItem(AUTH_LAST_METHOD_KEY, method);
	} catch {
		/* quota / private mode */
	}
}
