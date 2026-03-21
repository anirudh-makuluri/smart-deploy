import crypto from "crypto";

/**
 * Validates `X-Hub-Signature-256` for GitHub webhooks (HMAC SHA-256 over raw body).
 */
export function verifyGithubWebhookSignature(
	rawBody: string,
	signatureHeader: string | null | undefined,
	secret: string
): boolean {
	if (!signatureHeader?.trim() || !secret) return false;
	const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
	const sig = signatureHeader.trim();
	if (expected.length !== sig.length) return false;
	try {
		return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
	} catch {
		return false;
	}
}
