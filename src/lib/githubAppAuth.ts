import jwt from "jsonwebtoken";
import config from "../config";

function normalizePrivateKey(pem: string): string {
	return pem.replace(/\\n/g, "\n").trim();
}

export function createGithubAppJwt(): string {
	const appId = config.GITHUB_APP_ID?.trim();
	const privateKey = normalizePrivateKey(config.GITHUB_APP_PRIVATE_KEY || "");
	if (!appId || !privateKey) {
		throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
	}
	const now = Math.floor(Date.now() / 1000);
	return jwt.sign({ iat: now - 60, exp: now + 9 * 60, iss: appId }, privateKey, { algorithm: "RS256" });
}

export async function getInstallationAccessToken(installationId: number): Promise<string> {
	const appJwt = createGithubAppJwt();
	const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${appJwt}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	const data = (await res.json()) as { token?: string; message?: string };
	if (!res.ok) {
		throw new Error(data.message || `GitHub installation token failed (${res.status})`);
	}
	if (!data.token) {
		throw new Error("GitHub installation token response missing token");
	}
	return data.token;
}
