export const GATEWAY_SESSION_COOKIE = "__Host-smartdeploy-app-session";
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function sessionToken(cookie: string | null): string | null {
	if (!cookie || cookie.length > 16384) return null;
	const values = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(GATEWAY_SESSION_COOKIE + "="));
	if (values.length !== 1) return null;
	const value = values[0].slice(GATEWAY_SESSION_COOKIE.length + 1);
	return SECRET.test(value) ? value : null;
}

export function sessionCookie(token: string, expiresAt: Date, now: number): string {
	const remaining = Math.floor((expiresAt.getTime() - now) / 1000);
	if (!SECRET.test(token) || !Number.isFinite(remaining) || remaining < 1 || remaining > 3600) {
		throw new Error("Invalid app-session cookie.");
	}
	return `${GATEWAY_SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${remaining}`;
}
