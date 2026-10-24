import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSocketAuthToken, verifyWebSocketAuthToken } from "@/lib/wsAuth";
import { createHmac } from "node:crypto";

describe("wsAuth", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("creates and verifies a websocket auth token", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");

		const token = createWebSocketAuthToken("user-123", "session-123");
		const payload = verifyWebSocketAuthToken(token);

		expect(payload?.userID).toBe("user-123");
		expect(payload?.sessionID).toBe("session-123");
		expect(typeof payload?.exp).toBe("number");
	});

	it("rejects tampered tokens", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");

		const token = createWebSocketAuthToken("user-123", "session-123");
		const tampered = `${token}x`;

		expect(verifyWebSocketAuthToken(tampered)).toBeNull();
	});

	it("rejects a correctly signed legacy token without a platform-session binding", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
		const body = Buffer.from(JSON.stringify({ userID: "user-123", exp: Date.now() + 60_000 })).toString("base64url");
		const signature = createHmac("sha256", "test-secret").update(body).digest("base64url");
		expect(verifyWebSocketAuthToken(`${body}.${signature}`)).toBeNull();
		expect(verifyWebSocketAuthToken(`${createWebSocketAuthToken("user-123", "session-123")}.extra`)).toBeNull();
	});

	it("requires a platform session before issuing a token", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
		expect(() => createWebSocketAuthToken("user-123", "")).toThrow("sessionID is required");
	});

	it("rejects a correctly signed token for a different audience", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
		const body = Buffer.from(JSON.stringify({ audience: "different-service", version: 2, userID: "user-123", sessionID: "session-123", exp: Date.now() + 60_000 })).toString("base64url");
		const key = createHmac("sha256", "test-secret").update("smartdeploy-worker:v2").digest();
		const signature = createHmac("sha256", key).update(body).digest("base64url");
		expect(verifyWebSocketAuthToken(`${body}.${signature}`)).toBeNull();
	});

	it.each([undefined, "", 42])("requires a session identifier even in a correctly signed v2 envelope", (sessionID) => {
		vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
		const body = Buffer.from(JSON.stringify({ audience: "smartdeploy-worker", version: 2, userID: "user-123", sessionID, exp: Date.now() + 60_000 })).toString("base64url");
		const key = createHmac("sha256", "test-secret").update("smartdeploy-worker:v2").digest();
		const signature = createHmac("sha256", key).update(body).digest("base64url");
		expect(verifyWebSocketAuthToken(`${body}.${signature}`)).toBeNull();
	});
});
