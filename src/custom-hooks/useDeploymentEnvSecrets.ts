"use client";

import * as React from "react";
import {
	fetchDeploymentEnvSecrets,
	saveDeploymentEnvSecrets,
	type DeploymentEnvSecretEntry,
} from "@/lib/deploymentEnvSecretsClient";
import { buildEnvVarsString, parseEnvLinesToEntries } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { toast } from "sonner";

function meaningfulEntries(entries: DeploymentEnvSecretEntry[]): DeploymentEnvSecretEntry[] {
	return entries.filter((entry) => entry.name.trim().length > 0);
}

function entriesPersistenceKey(entries: DeploymentEnvSecretEntry[]): string {
	return JSON.stringify(meaningfulEntries(entries).map((entry) => ({ name: entry.name, value: entry.value })));
}

type UseDeploymentEnvSecretsArgs = {
	repoName: string;
	serviceName: string;
	secretsArn?: string | null;
	region?: string;
	repoUrl?: string;
	branch?: string;
};

export function useDeploymentEnvSecrets({
	repoName,
	serviceName,
	secretsArn,
	region,
	repoUrl,
	branch,
}: UseDeploymentEnvSecretsArgs) {
	const updateDeploymentById = useAppData((state) => state.updateDeploymentById);
	const [deploymentState, setDeploymentState] = React.useState<{
		entries: DeploymentEnvSecretEntry[];
		loadedDeploymentKey: string | null;
	}>({
		entries: [],
		loadedDeploymentKey: null,
	});
	const [isSaving, setIsSaving] = React.useState(false);
	const lastPersistedKeyRef = React.useRef<string | null>(null);

	const deploymentKey = `${repoName}:${serviceName}:${secretsArn ?? ""}`;
	const isLoading = Boolean(repoName && serviceName && deploymentState.loadedDeploymentKey !== deploymentKey);
	const entries = deploymentState.entries;

	React.useEffect(() => {
		if (!repoName || !serviceName) return undefined;

		let cancelled = false;

		void fetchDeploymentEnvSecrets(repoName, serviceName)
			.then((result) => {
				if (cancelled) return;
				const nextEntries = result.entries.length > 0 ? result.entries : [{ name: "", value: "" }];
				lastPersistedKeyRef.current = entriesPersistenceKey(nextEntries);
				setDeploymentState({
					entries: nextEntries,
					loadedDeploymentKey: deploymentKey,
				});
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				const message = error instanceof Error ? error.message : "Failed to load environment variables";
				toast.error(message);
				setDeploymentState({
					entries: [{ name: "", value: "" }],
					loadedDeploymentKey: deploymentKey,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [deploymentKey, repoName, serviceName]);

	const persistEntries = React.useCallback(
		async (nextEntries: DeploymentEnvSecretEntry[]) => {
			if (!repoName || !serviceName) return;
			setIsSaving(true);
			try {
				const result = await saveDeploymentEnvSecrets({
					repoName,
					serviceName,
					entries: nextEntries.filter((entry) => entry.name.trim().length > 0),
					region,
				});
				await updateDeploymentById({
					repoName,
					serviceName,
					repoUrl: repoUrl ?? "",
					branch: branch ?? "",
					secretsArn: result.secretsArn,
				});
				lastPersistedKeyRef.current = entriesPersistenceKey(nextEntries);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : "Failed to save environment variables";
				toast.error(message);
				throw error;
			} finally {
				setIsSaving(false);
			}
		},
		[branch, region, repoName, repoUrl, serviceName, updateDeploymentById]
	);

	const handleEntriesChange = React.useCallback((nextEntries: DeploymentEnvSecretEntry[]) => {
		setDeploymentState((current) => ({
			...current,
			entries: nextEntries,
		}));
	}, []);

	React.useEffect(() => {
		if (!repoName || !serviceName) return undefined;

		const timeout = setTimeout(() => {
			const nextKey = entriesPersistenceKey(entries);
			if (nextKey === lastPersistedKeyRef.current) return;
			if (nextKey === "[]" && !secretsArn) {
				lastPersistedKeyRef.current = nextKey;
				return;
			}
			void persistEntries(entries).catch(() => undefined);
		}, 700);

		return () => {
			clearTimeout(timeout);
		};
	}, [entries, persistEntries, repoName, secretsArn, serviceName]);

	const saveEnvString = React.useCallback(
		async (envString: string) => {
			const parsed = parseEnvLinesToEntries(envString);
			setDeploymentState((current) => ({
				...current,
				entries: parsed.length > 0 ? parsed : [{ name: "", value: "" }],
			}));
			await persistEntries(parsed);
		},
		[persistEntries]
	);

	const envVarsString = React.useMemo(() => buildEnvVarsString(meaningfulEntries(entries)), [entries]);

	return {
		entries,
		envVarsString,
		isLoading,
		isSaving,
		handleEntriesChange,
		saveEnvString,
	};
}
