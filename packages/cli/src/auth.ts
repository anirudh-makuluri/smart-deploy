import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_API_URL = "https://smart-deploy.xyz";

function credentialPath(): string {
	const base = process.env.SMART_DEPLOY_CONFIG_DIR?.trim() || process.env.APPDATA || join(homedir(), ".config");
	return join(base, "smart-deploy", "credentials.json");
}

export function getApiUrl(): string {
	return (process.env.SMART_DEPLOY_API_URL?.trim() || DEFAULT_API_URL).replace(/\/$/, "");
}

export async function readCliToken(): Promise<string | null> {
	try {
		const content = await readFile(credentialPath(), "utf8");
		const value = JSON.parse(content) as { token?: unknown };
		return typeof value.token === "string" && value.token.trim() ? value.token.trim() : null;
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error("Smart Deploy CLI credentials are invalid. Run smart-deploy logout and log in again.");
	}
}

export async function writeCliToken(token: string): Promise<void> {
	const path = credentialPath();
	const temporary = path + "." + process.pid + ".tmp";
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(temporary, JSON.stringify({ token }) + "\n", { encoding: "utf8", mode: 0o600 });
	await rename(temporary, path);
}

export async function clearCliToken(): Promise<void> {
	await rm(credentialPath(), { force: true });
}

export async function login(): Promise<void> {
	const start = await fetch(getApiUrl() + "/api/cli/device/start", { method: "POST" });
	if (!start.ok) throw new Error("Could not begin CLI login.");
	const request = await start.json() as { deviceCode: string; verificationUri: string; interval: number; expiresIn: number };
	console.log("Open this URL in a browser and approve Smart Deploy CLI:");
	console.log(request.verificationUri);
	const deadline = Date.now() + request.expiresIn * 1000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, request.interval * 1000));
		const response = await fetch(getApiUrl() + "/api/cli/device/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceCode: request.deviceCode }) });
		if (response.status === 202) continue;
		if (!response.ok) throw new Error("CLI login failed.");
		const token = await response.json() as { accessToken?: unknown };
		if (typeof token.accessToken !== "string") throw new Error("CLI login returned no access token.");
		await writeCliToken(token.accessToken);
		console.log("Smart Deploy CLI is connected.");
		return;
	}
	throw new Error("CLI authorization expired. Run smart-deploy login again.");
}

export async function logout(): Promise<void> {
	const token = await readCliToken();
	if (token) await fetch(getApiUrl() + "/api/cli/logout", { method: "POST", headers: { Authorization: "Bearer " + token } });
	await clearCliToken();
}
