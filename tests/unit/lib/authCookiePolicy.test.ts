import { describe, expect, it } from "vitest";
import { createCookieGetter } from "better-auth/cookies";
import { platformAuthCookiePolicy, platformSessionCookies } from "@/lib/authCookiePolicy";

describe("platform host-only auth cookie policy", () => {
	it.each(["https://smart-deploy.xyz", "https://preview.control.test", ""])("uses __Host cookies with the required attributes for %s", (baseURL) => {
		const cookies = platformSessionCookies(baseURL);
		expect(cookies.map((cookie) => cookie.name)).toEqual([
			"__Host-smartdeploy.session_token", "__Host-smartdeploy.session_data", "__Host-smartdeploy.dont_remember", "__Host-smartdeploy.account_data",
		]);
		for (const cookie of cookies) {
			expect(cookie.attributes).toMatchObject({ secure: true, httpOnly: true, path: "/", sameSite: "lax" });
			expect(cookie.attributes.domain).toBeUndefined();
		}
	});
	it("applies the same boundary to dynamically created OAuth-state cookies", () => {
		const options = { baseURL: "https://smart-deploy.xyz", advanced: platformAuthCookiePolicy("https://smart-deploy.xyz") };
		const state = createCookieGetter(options)("oauth_state");
		expect(state.name).toBe("__Host-smartdeploy.oauth_state");
		expect(state.attributes).toMatchObject({ secure: true, httpOnly: true, path: "/" });
		expect(state.attributes.domain).toBeUndefined();
	});
	it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])("keeps explicit loopback HTTP development working at %s", (baseURL) => {
		const [cookie] = platformSessionCookies(baseURL);
		expect(cookie.name).toBe("better-auth.session_token");
		expect(cookie.attributes.secure).toBe(false);
	});
	it.each(["http://smart-deploy.xyz", "http://localhost.attacker.test", "https://user:secret@control.test", "https://control.test?x=1", "https://control.test#fragment"])("rejects unsafe configuration %s", (baseURL) => {
		expect(() => platformAuthCookiePolicy(baseURL)).toThrow();
	});
});
