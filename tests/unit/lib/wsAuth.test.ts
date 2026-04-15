import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSocketAuthToken, verifyWebSocketAuthToken } from "@/lib/wsAuth";

describe("wsAuth", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("creates and verifies a websocket auth token", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");

		const token = createWebSocketAuthToken("user-123");
		const payload = verifyWebSocketAuthToken(token);

		expect(payload?.userID).toBe("user-123");
		expect(typeof payload?.exp).toBe("number");
	});

	it("rejects tampered tokens", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");

		const token = createWebSocketAuthToken("user-123");
		const tampered = `${token}x`;

		expect(verifyWebSocketAuthToken(tampered)).toBeNull();
	});
});
