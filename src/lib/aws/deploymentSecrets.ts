import {
	CreateSecretCommand,
	DeleteSecretCommand,
	GetSecretValueCommand,
	PutSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
	IAMClient,
	GetRoleCommand,
	PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import config from "../../config";
import { getAwsClientConfig } from "./sdkClients";

export type EnvSecretEntry = { name: string; value: string };

const SECRET_POLICY_NAME = "smartdeploy-ecs-secrets-read";
const SECRET_NAME_PREFIX = "smartdeploy/";

function awsNameChunk(value: string, max: number): string {
	const out = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, max);
	return out || "app";
}

export function buildDeploymentSecretName(userId: string, repoName: string, serviceName: string): string {
	const userChunk = awsNameChunk(userId, 40);
	const repoChunk = awsNameChunk(repoName, 80);
	const serviceChunk = awsNameChunk(serviceName, 80);
	return `${SECRET_NAME_PREFIX}${userChunk}/${repoChunk}/${serviceChunk}`;
}

export function envEntriesToSecretObject(entries: EnvSecretEntry[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const entry of entries) {
		const name = entry.name.trim();
		if (!name) continue;
		out[name] = entry.value;
	}
	return out;
}

export function secretObjectToEntries(secretObject: Record<string, string>): EnvSecretEntry[] {
	return Object.entries(secretObject).map(([name, value]) => ({ name, value }));
}

/** ECS `valueFrom` reference for a JSON key inside a Secrets Manager secret. */
export function ecsSecretReference(secretsArn: string, key: string): string {
	const arn = secretsArn.trim();
	if (!arn) throw new Error("Missing secrets ARN");
	return `${arn}:${key}::`;
}

export function buildEcsContainerSecrets(
	secretsArn: string,
	keys: string[]
): { name: string; valueFrom: string }[] {
	const uniqueKeys = [...new Set(keys.flatMap((key) => {
		const trimmed = key.trim();
		return trimmed ? [trimmed] : [];
	}))];
	return uniqueKeys.slice(0, 50).map((key) => ({
		name: key,
		valueFrom: ecsSecretReference(secretsArn, key),
	}));
}

function parseSecretString(secretString: string): Record<string, string> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(secretString);
	} catch {
		throw new Error("Deployment secret is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Deployment secret must be a JSON object");
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!key.trim()) continue;
		out[key] = value == null ? "" : String(value);
	}
	return out;
}

export async function getDeploymentEnvSecretObject(params: {
	region: string;
	secretsArn: string;
}): Promise<Record<string, string>> {
	const client = new SecretsManagerClient(getAwsClientConfig(params.region));
	const resp = await client.send(
		new GetSecretValueCommand({ SecretId: params.secretsArn.trim() })
	);
	const secretString = resp.SecretString?.trim();
	if (!secretString) return {};
	return parseSecretString(secretString);
}

export async function getDeploymentEnvSecretEntries(params: {
	region: string;
	secretsArn: string;
}): Promise<EnvSecretEntry[]> {
	const secretObject = await getDeploymentEnvSecretObject(params);
	return secretObjectToEntries(secretObject);
}

export async function upsertDeploymentEnvSecret(params: {
	region: string;
	userId: string;
	repoName: string;
	serviceName: string;
	entries: EnvSecretEntry[];
	existingArn?: string | null;
}): Promise<{ secretsArn: string | null }> {
	const secretObject = envEntriesToSecretObject(params.entries);
	const client = new SecretsManagerClient(getAwsClientConfig(params.region));
	const existingArn = params.existingArn?.trim() || "";

	if (Object.keys(secretObject).length === 0) {
		if (existingArn) {
			try {
				await client.send(
					new DeleteSecretCommand({
						SecretId: existingArn,
						ForceDeleteWithoutRecovery: true,
					})
				);
			} catch {
				// Best-effort cleanup when clearing all variables.
			}
		}
		return { secretsArn: null };
	}

	const secretString = JSON.stringify(secretObject);

	if (existingArn) {
		try {
			await client.send(
				new PutSecretValueCommand({
					SecretId: existingArn,
					SecretString: secretString,
				})
			);
			return { secretsArn: existingArn };
		} catch {
			// Fall through to create when the stored ARN is stale.
		}
	}

	const createResp = await client.send(
		new CreateSecretCommand({
			Name: buildDeploymentSecretName(params.userId, params.repoName, params.serviceName),
			SecretString: secretString,
			Tags: [
				{ Key: "smartdeploy:managed", Value: "true" },
				{ Key: "smartdeploy:user", Value: params.userId },
				{ Key: "smartdeploy:repo", Value: params.repoName },
				{ Key: "smartdeploy:service", Value: params.serviceName },
			],
		})
	);
	const secretsArn = createResp.ARN?.trim();
	if (!secretsArn) throw new Error("Secrets Manager did not return a secret ARN");
	return { secretsArn };
}

function executionRoleNameFromArn(roleArn: string): string | null {
	const trimmed = roleArn.trim();
	if (!trimmed) return null;
	const marker = ":role/";
	const idx = trimmed.indexOf(marker);
	if (idx === -1) return null;
	const name = trimmed.slice(idx + marker.length).trim();
	return name || null;
}

/**
 * Ensure the shared ECS execution role can read Smart Deploy deployment secrets.
 * Safe to call on every deploy; uses a stable inline policy name.
 */
export async function ensureEcsExecutionRoleSecretsAccess(region: string): Promise<void> {
	const roleArn = config.ECS_EXECUTION_ROLE_ARN?.trim();
	if (!roleArn) return;

	const roleName = executionRoleNameFromArn(roleArn);
	if (!roleName) return;

	const iam = new IAMClient(getAwsClientConfig(region));
	try {
		await iam.send(new GetRoleCommand({ RoleName: roleName }));
	} catch {
		return;
	}

	const policy = JSON.stringify({
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: ["secretsmanager:GetSecretValue"],
				Resource: `arn:aws:secretsmanager:${region}:*:secret:${SECRET_NAME_PREFIX}*`,
			},
		],
	});

	await iam.send(
		new PutRolePolicyCommand({
			RoleName: roleName,
			PolicyName: SECRET_POLICY_NAME,
			PolicyDocument: policy,
		})
	);
}
