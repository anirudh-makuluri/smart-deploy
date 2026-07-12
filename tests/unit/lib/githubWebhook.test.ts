import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGithubAppJwt, verifyGithubWebhookSignature } from "@/lib/githubApp";
import { parseGithubPushWebhook } from "@/lib/githubWebhook";

const commitSha = "a".repeat(40);

describe("GitHub webhook validation", () => {
	it("accepts a signed main push with installation metadata", () => {
		const payload = JSON.stringify({
			ref: "refs/heads/main",
			after: commitSha,
			installation: { id: 42 },
			repository: {
				id: 99,
				full_name: "acme/shop",
				html_url: "https://github.com/acme/shop",
			},
		});
		const secret = "webhook-secret";
		const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

		expect(verifyGithubWebhookSignature({ payload, signature, webhookSecret: secret })).toBe(true);
		expect(parseGithubPushWebhook(JSON.parse(payload))).toEqual({
			installationId: 42,
			repositoryId: 99,
			fullName: "acme/shop",
			repositoryUrl: "https://github.com/acme/shop",
			branch: "main",
			commitSha,
		});
	});

	it("rejects invalid signatures and branch-deletion push payloads", () => {
		const payload = JSON.stringify({ ref: "refs/heads/main" });
		expect(verifyGithubWebhookSignature({
			payload,
			signature: "sha256=not-a-valid-signature",
			webhookSecret: "webhook-secret",
		})).toBe(false);

		expect(parseGithubPushWebhook({
			ref: "refs/heads/main",
			after: "0".repeat(40),
			installation: { id: 42 },
			repository: { id: 99, full_name: "acme/shop", html_url: "https://github.com/acme/shop" },
		})).toBeNull();
	});

	it("signs a short-lived GitHub App JWT with the App ID as issuer", () => {
		const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const privateKey = keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString();
		const now = 1_700_000_000;
		const jwt = createGithubAppJwt({
			appId: "4275713",
			clientId: "client-id",
			clientSecret: "client-secret",
			privateKey,
			webhookSecret: "webhook-secret",
		}, now);
		const [header, payload, signature] = jwt.split(".");

		const verifier = createVerify("RSA-SHA256");
		verifier.update(`${header}.${payload}`);
		verifier.end();
		expect(verifier.verify(keys.publicKey, signature, "base64url")).toBe(true);
		expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
			iat: now - 60,
			exp: now + 9 * 60,
			iss: "4275713",
		});
	});
});
