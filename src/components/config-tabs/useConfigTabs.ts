"use client";

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { parseEnvVarsToDisplay, buildEnvVarsString, sanitizeSubdomain } from "@/lib/utils";
import { toast } from "sonner";
import type { DeployConfig } from "@/app/types";
import {
	DEFAULT_EC2_INSTANCE_TYPE,
	EC2_INSTANCE_TYPE_PRESETS,
} from "@/lib/aws/ec2InstanceTypes";
import { updateCustomDomain } from "@/lib/graphqlClient";
import { useAppData } from "@/store/useAppData";
import {
	formSchema,
	getHostedUrlFromSubdomain,
	mapCustomDomainError,
	savedHostedSubdomain,
	type FormSchemaType,
} from "@/components/config-tabs/configTabsUtils";

type UseConfigTabsProps = {
	onConfigChange: (partial: Partial<DeployConfig>) => void;
	deployment: DeployConfig;
	branches?: string[];
};

export function useConfigTabs({ onConfigChange, deployment, branches: branchesProp }: UseConfigTabsProps) {
	const [envEntries, setEnvEntries] = useState<{ name: string; value: string }[]>(() =>
		parseEnvVarsToDisplay(deployment.envVars ?? "")
	);

	const updateDeploymentById = useAppData((state) => state.updateDeploymentById);
	const [isEnvSheetOpen, setIsEnvSheetOpen] = useState(false);
	const hostedSubdomainVerifying = false;
	const [hostedSubdomainStatus, setHostedSubdomainStatus] = useState<{
		type: "success" | "error" | "owned" | null;
		message?: string;
		alternatives?: string[];
	}>({ type: null });
	const deploymentCloudResources = deployment.cloudResources;

	const savedSubdomain = React.useMemo(() => savedHostedSubdomain(deployment), [deployment]);

	const form = useForm<FormSchemaType>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			branch: deployment.branch,
			envVars: deployment.envVars ?? "",
			hostedSubdomain: savedSubdomain,
		},
	});

	const hostedSubdomainValue = form.watch("hostedSubdomain");
	const [hostedSubdomainSaving, setHostedSubdomainSaving] = useState(false);
	const isHostedSubdomainDirty = hostedSubdomainValue !== savedSubdomain;

	const handleSaveHostedSubdomain = async () => {
		if (!deployment) return;
		const raw = form.getValues("hostedSubdomain") ?? "";
		const trimmedValue = raw.trim();
		const finalUrl = trimmedValue ? getHostedUrlFromSubdomain(trimmedValue) : "";
		const subdomainSlug = trimmedValue ? sanitizeSubdomain(trimmedValue) : "";
		const previousSubdomain = savedHostedSubdomain(deployment);
		if (subdomainSlug === previousSubdomain) {
			return;
		}

		setHostedSubdomainSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repoName, deployment.serviceName, finalUrl);

			updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				hostedSubdomain: subdomainSlug || null,
			});
			setHostedSubdomainStatus({
				type: finalUrl ? "success" : null,
				message: finalUrl ? data?.message || `Hosted subdomain saved: ${finalUrl}` : undefined,
			});
			if (finalUrl) {
				toast.success(data?.message || "Hosted subdomain saved");
			} else {
				toast.success("Hosted subdomain cleared");
			}
		} catch (error: unknown) {
			const message = mapCustomDomainError(error);
			setHostedSubdomainStatus({ type: "error", message });
			toast.error(message);
		} finally {
			setHostedSubdomainSaving(false);
		}
	};

	const handleCancelHostedSubdomain = () => {
		form.setValue("hostedSubdomain", savedSubdomain, { shouldDirty: false });
		setHostedSubdomainStatus({ type: null });
	};

	const handleEnvEntriesChange = React.useCallback((entries: { name: string; value: string }[]) => {
		setEnvEntries(entries);
	}, []);

	React.useEffect(() => {
		const envString = buildEnvVarsString(envEntries);
		if (envString === deployment.envVars) return undefined;

		const timeout = setTimeout(() => {
			onConfigChange({ envVars: envString });
		}, 500);

		return () => {
			clearTimeout(timeout);
		};
	}, [deployment.envVars, envEntries, onConfigChange]);

	const hasScanResults = !!deployment.scanResults && Object.keys(deployment.scanResults).length > 0;

	const ec2InstanceOptions = React.useMemo(() => [...EC2_INSTANCE_TYPE_PRESETS], []);
	const ec2InstanceValue = DEFAULT_EC2_INSTANCE_TYPE;

	const branchSelectOptions = React.useMemo(() => {
		const fromRepo = (branchesProp ?? []).filter(Boolean);
		const current = deployment.branch?.trim();
		if (current && !fromRepo.includes(current)) {
			return [current, ...fromRepo];
		}
		return fromRepo.length > 0 ? fromRepo : current ? [current] : [];
	}, [branchesProp, deployment.branch]);

	return {
		form,
		deployment,
		deploymentCloudResources,
		envEntries,
		isEnvSheetOpen,
		setIsEnvSheetOpen,
		handleEnvEntriesChange,
		hostedSubdomainVerifying,
		hostedSubdomainStatus,
		setHostedSubdomainStatus,
		hostedSubdomainSaving,
		isHostedSubdomainDirty,
		handleSaveHostedSubdomain,
		handleCancelHostedSubdomain,
		hasScanResults,
		ec2InstanceOptions,
		ec2InstanceValue,
		branchSelectOptions,
		onConfigChange,
	};
}
