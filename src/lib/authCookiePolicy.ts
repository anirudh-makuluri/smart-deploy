import { getCookies } from "better-auth/cookies";

export interface PlatformCookiePolicy {
	cookiePrefix: string;
	useSecureCookies: false;
	crossSubDomainCookies: { enabled: false };
	defaultCookieAttributes: { secure: boolean; httpOnly: true; path: "/"; sameSite: "lax" };
}

export function platformAuthCookiePolicy(baseURL: string): PlatformCookiePolicy {
	let localHttp = false;
	if (baseURL) {
		const url = new URL(baseURL);
		if (url.username || url.password || url.search || url.hash) throw new Error("Invalid platform auth origin.");
		localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.protocol !== "https:" && !localHttp) throw new Error("Platform auth requires HTTPS outside loopback development.");
	}
	return {
		cookiePrefix: localHttp ? "better-auth" : "__Host-smartdeploy",
		// Disable the SDK's automatic __Secure- name prefix. The explicit __Host-
		// prefix requires Secure, Path=/ and no Domain on every HTTPS auth cookie.
		useSecureCookies: false,
		crossSubDomainCookies: { enabled: false },
		defaultCookieAttributes: { secure: !localHttp, httpOnly: true, path: "/", sameSite: "lax" },
	};
}

/** Use the same SDK definitions for detection and deletion as for authentication. */
export function platformSessionCookies(baseURL: string) {
	const cookies = getCookies({ baseURL: baseURL || undefined, advanced: platformAuthCookiePolicy(baseURL) });
	return [cookies.sessionToken, cookies.sessionData, cookies.dontRememberToken, cookies.accountData];
}
