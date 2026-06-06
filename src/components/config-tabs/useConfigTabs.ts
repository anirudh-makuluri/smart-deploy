"use client";

import * as React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { parseEnvVarsToDisplay, buildEnvVarsString } from "@/lib/utils";
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
	getCustomUrlFromSubdomain,
	getInitialSubdomain,
	mapCustomDomainError,
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
	const customUrlVerifying = false;
	const [customUrlStatus, setCustomUrlStatus] = useState<{
		type: "success" | "error" | "owned" | null;
		message?: string;
		alternatives?: string[];
	}>({ type: null });
	const deploymentEc2 = deployment.ec2;

	const initialSubdomain = React.useMemo(() => getInitialSubdomain(deployment), [deployment]);

	const form = useForm<FormSchemaType>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			branch: deployment.branch,
			envVars: deployment.envVars ?? "",
			liveUrl: initialSubdomain,
		},
	});

	const liveUrlValue = form.watch("liveUrl");
	const [customUrlSaving, setCustomUrlSaving] = useState(false);
	const isCustomUrlDirty = liveUrlValue !== initialSubdomain;

	const handleSaveCustomUrl = async () => {
		if (!deployment) return;
		const raw = form.getValues("liveUrl") ?? "";
		const trimmedValue = raw.trim();
		const finalUrl = trimmedValue ? getCustomUrlFromSubdomain(trimmedValue) : "";
		const previousUrl = (deployment.liveUrl || "").trim();
		if (finalUrl === previousUrl) {
			return;
		}

		setCustomUrlSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repoName, deployment.serviceName, finalUrl);

			updateDeploymentById({
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				liveUrl: finalUrl,
			});
			setCustomUrlStatus({
				type: finalUrl ? "success" : null,
				message: finalUrl ? data?.message || `Custom domain saved: ${finalUrl}` : undefined,
			});
			if (finalUrl) {
				toast.success(data?.message || "Custom domain saved");
			} else {
				toast.success("Custom domain cleared");
			}
		} catch (error: unknown) {
			const message = mapCustomDomainError(error);
			setCustomUrlStatus({ type: "error", message });
			toast.error(message);
		} finally {
			setCustomUrlSaving(false);
		}
	};

	const handleCancelCustomUrl = () => {
		form.setValue("liveUrl", initialSubdomain, { shouldDirty: false });
		setCustomUrlStatus({ type: null });
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

	const hasScanResults = !!deployment.scanResults;

	const ec2InstanceOptions = React.useMemo(() => {
		const v = deploymentEc2?.instanceType?.trim();
		const list: string[] = [...EC2_INSTANCE_TYPE_PRESETS];
		if (v && !list.some((x) => x === v)) list.unshift(v);
		return list;
	}, [deploymentEc2]);

	const ec2InstanceValue = deploymentEc2?.instanceType?.trim() || DEFAULT_EC2_INSTANCE_TYPE;

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
		deploymentEc2,
		envEntries,
		isEnvSheetOpen,
		setIsEnvSheetOpen,
		handleEnvEntriesChange,
		customUrlVerifying,
		customUrlStatus,
		setCustomUrlStatus,
		customUrlSaving,
		isCustomUrlDirty,
		handleSaveCustomUrl,
		handleCancelCustomUrl,
		hasScanResults,
		ec2InstanceOptions,
		ec2InstanceValue,
		branchSelectOptions,
		onConfigChange,
	};
}
