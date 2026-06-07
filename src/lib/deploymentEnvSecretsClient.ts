export type DeploymentEnvSecretEntry = { name: string; value: string };

export async function fetchDeploymentEnvSecrets(repoName: string, serviceName: string): Promise<{
	secretsArn: string | null;
	entries: DeploymentEnvSecretEntry[];
}> {
	const params = new URLSearchParams({ repoName, serviceName });
	const res = await fetch(`/api/deployments/env-secrets?${params.toString()}`, { method: "GET" });
	const payload = (await res.json()) as {
		error?: string;
		secretsArn?: string | null;
		entries?: DeploymentEnvSecretEntry[];
	};
	if (!res.ok) {
		throw new Error(payload.error || "Failed to load environment variables");
	}
	return {
		secretsArn: payload.secretsArn ?? null,
		entries: Array.isArray(payload.entries) ? payload.entries : [],
	};
}

export async function saveDeploymentEnvSecrets(args: {
	repoName: string;
	serviceName: string;
	entries: DeploymentEnvSecretEntry[];
	region?: string;
}): Promise<{ secretsArn: string | null; entryCount: number }> {
	const res = await fetch("/api/deployments/env-secrets", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(args),
	});
	const payload = (await res.json()) as {
		error?: string;
		secretsArn?: string | null;
		entryCount?: number;
	};
	if (!res.ok) {
		throw new Error(payload.error || "Failed to save environment variables");
	}
	return {
		secretsArn: payload.secretsArn ?? null,
		entryCount: typeof payload.entryCount === "number" ? payload.entryCount : args.entries.length,
	};
}
