import { describe, expect, it } from "vitest";
import { createCliAccessToken, createDeviceAuthorizationSecrets, getCliBearerToken, hashCliSecret } from "@/lib/cliAuth";

describe("CLI device authentication primitives", () => {
	it("creates distinct high-entropy device authorization codes", () => {
		const authorization = createDeviceAuthorizationSecrets(new Date("2026-01-01T00:00:00.000Z"));
		expect(authorization.deviceCode).not.toBe(authorization.approvalCode);
		expect(authorization.deviceCode.length).toBeGreaterThan(40);
		expect(authorization.expiresAt.toISOString()).toBe("2026-01-01T00:10:00.000Z");
	});

	it("issues prefixed tokens and hashes secrets deterministically", () => {
		const token = createCliAccessToken();
		expect(token.token).toMatch(/^sd_cli_[A-Za-z0-9_-]+$/);
		expect(token.tokenHash).toBe(hashCliSecret(token.token));
	});

	it("accepts only a complete CLI bearer token", () => {
		expect(getCliBearerToken(new Headers({ Authorization: "Bearer sd_cli_abc123" }))).toBe("sd_cli_abc123");
		expect(getCliBearerToken(new Headers({ Authorization: "Bearer github-token" }))).toBeNull();
	});
});
