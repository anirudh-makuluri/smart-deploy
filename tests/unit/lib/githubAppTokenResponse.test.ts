import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubInstallationAccessToken } from "@/lib/githubApp";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});

beforeEach(() => {
	vi.stubEnv("GITHUB_APP_ID", "123");
	vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET", "local-test-only");
	vi.stubEnv("GITHUB_APP_PRIVATE_KEY_BASE64", Buffer.from(privateKey).toString("base64"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("GitHub installation token response boundary", () => {
	it.each([null, [], { message: { unexpected: true } }])("preserves an HTTP failure when the error body is not a message object", async (body) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status: 403 }));
		await expect(createGithubInstallationAccessToken(1)).rejects.toThrow("GitHub App installation token request failed (403)");
	});

	it("retains a useful provider error message", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Bad credentials" }, { status: 401 }));
		await expect(createGithubInstallationAccessToken(1)).rejects.toThrow("GitHub App installation token request failed (401): Bad credentials");
	});

	it.each([null, [], { token: "" }])("rejects a malformed token success body without a TypeError", async (body) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
		await expect(createGithubInstallationAccessToken(1)).rejects.toThrow("GitHub App installation token response was missing a token");
	});

	it("accepts a well-formed response and rejects a missing expiry", async () => {
		const body = { token: "local-test-token", expires_at: "2026-10-25T00:00:00Z" };
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(Response.json({ token: body.token }));
		await expect(createGithubInstallationAccessToken(1)).resolves.toEqual({ token: body.token, expiresAt: body.expires_at });
		await expect(createGithubInstallationAccessToken(1)).rejects.toThrow("GitHub App installation token response was missing an expiry");
	});
});
