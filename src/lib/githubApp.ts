import {
	createHmac,
	createSign,
	timingSafeEqual,
} from "node:crypto";

type GithubAppConfig = {
	appId: string;
	clientId: string;
	clientSecret: string;
	privateKey: string;
	webhookSecret: string;
};

type GithubInstallationTokenResponse = {
	token?: unknown;
	expires_at?: unknown;
	message?: unknown;
};

export type GithubInstallationAccessToken = {
	token: string;
	expiresAt: string;
};

function readEnv(name: string): string {
	return (process.env[name] || "").trim();
}

function decodePrivateKey(value: string): string {
	if (!value) return "";
	if (value.includes("BEGIN")) return value.replace(/\\n/g, "\n");
	try {
		return Buffer.from(value, "base64").toString("utf8").trim();
	} catch {
		return "";
	}
}

function configuredValue(name: keyof GithubAppConfig, config: GithubAppConfig): string {
	return config[name].trim();
}

export function getGithubAppConfig(): GithubAppConfig | null {
	const config: GithubAppConfig = {
		appId: readEnv("GITHUB_APP_ID"),
		clientId: readEnv("GITHUB_APP_CLIENT_ID"),
		clientSecret: readEnv("GITHUB_APP_CLIENT_SECRET"),
		privateKey: decodePrivateKey(readEnv("GITHUB_APP_PRIVATE_KEY_BASE64")),
		webhookSecret: readEnv("GITHUB_APP_WEBHOOK_SECRET"),
	};

	const required: Array<keyof GithubAppConfig> = ["appId", "privateKey", "webhookSecret"];
	if (required.some((name) => !configuredValue(name, config))) return null;
	return config;
}

export function verifyGithubWebhookSignature(args: {
	payload: string;
	signature: string | null;
	webhookSecret: string;
}): boolean {
	const signature = args.signature?.trim() || "";
	if (!signature.startsWith("sha256=") || !args.webhookSecret) return false;

	const expected = `sha256=${createHmac("sha256", args.webhookSecret).update(args.payload).digest("hex")}`;
	const providedBuffer = Buffer.from(signature, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createGithubAppJwt(config: GithubAppConfig, nowSeconds = Math.floor(Date.now() / 1_000)): string {
	const encode = (value: Record<string, unknown>): string =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const header = encode({ alg: "RS256", typ: "JWT" });
	const payload = encode({
		// GitHub allows a maximum JWT lifetime of 10 minutes. Leave a small
		// clock-skew margin to avoid intermittent authentication failures.
		iat: nowSeconds - 60,
		exp: nowSeconds + 9 * 60,
		iss: config.appId,
	});
	const signer = createSign("RSA-SHA256");
	signer.update(`${header}.${payload}`);
	signer.end();
	return `${header}.${payload}.${signer.sign(config.privateKey, "base64url")}`;
}

export async function createGithubInstallationAccessToken(
	installationId: number
): Promise<GithubInstallationAccessToken> {
	if (!Number.isSafeInteger(installationId) || installationId <= 0) {
		throw new Error("A valid GitHub App installation ID is required.");
	}

	const config = getGithubAppConfig();
	if (!config) {
		throw new Error("GitHub App server configuration is incomplete.");
	}

	const response = await fetch(
		`https://api.github.com/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${createGithubAppJwt(config)}`,
				"User-Agent": "smart-deploy/github-app",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		}
	);

	const responseBody = (await response.json().catch(() => ({}))) as GithubInstallationTokenResponse;
	if (!response.ok) {
		const detail = typeof responseBody.message === "string" ? `: ${responseBody.message}` : "";
		throw new Error(`GitHub App installation token request failed (${response.status})${detail}`);
	}

	if (typeof responseBody.token !== "string" || !responseBody.token.trim()) {
		throw new Error("GitHub App installation token response was missing a token.");
	}
	if (typeof responseBody.expires_at !== "string" || !responseBody.expires_at.trim()) {
		throw new Error("GitHub App installation token response was missing an expiry.");
	}

	return { token: responseBody.token, expiresAt: responseBody.expires_at };
}
