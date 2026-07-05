import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

function parseDotenvSecret(raw: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf("=");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		let value = trimmed.slice(separator + 1).trim();
		if (
			(value.startsWith("\"") && value.endsWith("\"")) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key) values[key] = value;
	}
	return values;
}

function parseSecretString(secretString: string): Record<string, string> {
	try {
		const parsed = JSON.parse(secretString) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed as Record<string, unknown>)
				.filter(([key, value]) => key.trim() && value != null)
				.map(([key, value]) => [key, String(value)])
		);
	} catch {
		return parseDotenvSecret(secretString);
	}
}

export async function loadRuntimeSecretEnv(): Promise<{ loaded: number; secretArn: string | null }> {
	const secretArnEnvName = "AWS_SECRETS_ARN";
	const secretArn = (
		process.env[secretArnEnvName] ||
		process.env.SMARTDEPLOY_WORKER_SECRET_ARN ||
		""
	).trim();
	if (!secretArn) return { loaded: 0, secretArn: null };

	const region = process.env.AWS_REGION || "us-west-2";
	const client = new SecretsManagerClient({ region });
	const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
	const secretString = response.SecretString ?? "";
	if (!secretString) return { loaded: 0, secretArn };

	const values = parseSecretString(secretString);
	let loaded = 0;
	for (const [key, value] of Object.entries(values)) {
		if ((process.env[key] || "") !== "") continue;
		process.env[key] = value;
		loaded += 1;
	}

	return { loaded, secretArn };
}

export const __testing = {
	parseSecretString,
};
