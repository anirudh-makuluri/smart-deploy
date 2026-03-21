import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubWebhookSignature } from "@/lib/githubWebhookVerify";
import { isNullSha, pushBranchFromRef } from "@/lib/githubPushWebhook";
import { githubFullNameFromUrl } from "@/lib/githubRepo";

describe("verifyGithubWebhookSignature", () => {
	it("accepts valid HMAC SHA-256 signature", () => {
		const secret = "mysecret";
		const body = '{"ref":"refs/heads/main"}';
		const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
		expect(verifyGithubWebhookSignature(body, sig, secret)).toBe(true);
	});

	it("rejects wrong secret", () => {
		const body = "{}";
		const sig = "sha256=" + crypto.createHmac("sha256", "a").update(body, "utf8").digest("hex");
		expect(verifyGithubWebhookSignature(body, sig, "b")).toBe(false);
	});

	it("rejects missing header", () => {
		expect(verifyGithubWebhookSignature("{}", null, "s")).toBe(false);
	});
});

describe("pushBranchFromRef", () => {
	it("parses heads ref", () => {
		expect(pushBranchFromRef("refs/heads/main")).toBe("main");
		expect(pushBranchFromRef("refs/heads/feature/x")).toBe("feature/x");
	});

	it("returns null for tags or invalid", () => {
		expect(pushBranchFromRef("refs/tags/v1")).toBeNull();
		expect(pushBranchFromRef(null)).toBeNull();
	});
});

describe("isNullSha", () => {
	it("detects null / delete shas", () => {
		expect(isNullSha("0000000000000000000000000000000000000000")).toBe(true);
		expect(isNullSha("abc")).toBe(false);
	});
});

describe("githubFullNameFromUrl", () => {
	it("parses HTTPS and SSH GitHub URLs", () => {
		expect(githubFullNameFromUrl("https://github.com/acme/app")).toBe("acme/app");
		expect(githubFullNameFromUrl("https://github.com/acme/app.git")).toBe("acme/app");
		expect(githubFullNameFromUrl("git@github.com:acme/app.git")).toBe("acme/app");
	});
});
