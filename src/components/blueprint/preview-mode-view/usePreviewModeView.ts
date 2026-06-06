"use client";

import * as React from "react";
import { buildPreviewModel, type PreviewArtifact } from "@/components/blueprint/preview-model";
import { AWS_REGION_OPTIONS } from "@/components/blueprint/blueprint-fields";
import { defaultAwsRegionForDeploy } from "@/lib/deployInfraDefaults";
import { updateCustomDomain } from "@/lib/graphqlClient";
import { toast } from "sonner";
import type {
	CustomDomainEditorState,
	CustomUrlStatus,
	Editor,
	PreviewModeViewProps,
} from "@/components/blueprint/preview-mode-view/types";
import {
	getCustomUrlFromSubdomain,
	getInitialSubdomain,
	groupByStep,
	groupWarningsByStep,
	mapCustomDomainError,
} from "@/components/blueprint/preview-mode-view/utils";

export function usePreviewModeView({
	deployment,
	scanResults,
	onUpdateDeployment,
}: PreviewModeViewProps) {
	const model = React.useMemo(() => buildPreviewModel({ deployment, scanResults }), [deployment, scanResults]);
	const artifactsByStep = React.useMemo(() => groupByStep(model.artifacts), [model.artifacts]);
	const [editor, setEditor] = React.useState<Editor>(null);

	const customUrlVerifying = false;
	const [customUrlSaving, setCustomUrlSaving] = React.useState(false);
	const [customDomainEditor, setCustomDomainEditor] = React.useState<CustomDomainEditorState | null>(null);

	const initialSubdomain = React.useMemo(() => getInitialSubdomain(deployment.liveUrl), [deployment.liveUrl]);

	const liveUrlKey = deployment.liveUrl ?? "";
	const isEditingCustomDomain = editor?.kind === "customDomain";
	const customDomainMatchesCurrentUrl =
		isEditingCustomDomain &&
		customDomainEditor !== null &&
		customDomainEditor.liveUrl === liveUrlKey;
	const subdomainDraft = customDomainMatchesCurrentUrl ? customDomainEditor.draft : initialSubdomain;
	const customUrlStatus = customDomainMatchesCurrentUrl ? customDomainEditor.status : { type: null };

	const updateSubdomainDraft = React.useCallback(
		(draft: string, status: CustomUrlStatus = { type: null }) => {
			setCustomDomainEditor({ liveUrl: liveUrlKey, draft, status });
		},
		[liveUrlKey]
	);

	const isCustomUrlDirty = subdomainDraft !== initialSubdomain;

	const handleSaveCustomUrl = React.useCallback(async () => {
		const trimmed = subdomainDraft.trim();
		const finalUrl = getCustomUrlFromSubdomain(trimmed);
		const previousUrl = (deployment.liveUrl || "").trim();
		if (finalUrl === previousUrl) return;

		setCustomUrlSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repoName, deployment.serviceName, finalUrl);
			await onUpdateDeployment({ liveUrl: finalUrl || null });
			updateSubdomainDraft(subdomainDraft, {
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
			updateSubdomainDraft(subdomainDraft, { type: "error", message });
			toast.error(message);
		} finally {
			setCustomUrlSaving(false);
		}
	}, [deployment.liveUrl, deployment.repoName, deployment.serviceName, onUpdateDeployment, subdomainDraft, updateSubdomainDraft]);

	const handleCancelCustomUrl = React.useCallback(() => {
		updateSubdomainDraft(initialSubdomain);
	}, [initialSubdomain, updateSubdomainDraft]);

	const deployUnits = React.useMemo(() => scanResults?.deploy_units ?? [], [scanResults?.deploy_units]);
	const primaryUnitName = React.useMemo(() => deployUnits[0]?.name, [deployUnits]);
	const selectedUnit = React.useMemo(() => {
		const name = editor?.kind === "dockerfile" ? editor.unitName ?? primaryUnitName : primaryUnitName;
		return deployUnits.find((u) => u.name === name) ?? deployUnits[0];
	}, [deployUnits, editor, primaryUnitName]);
	const railpackPlanJson = React.useMemo(() => {
		const plan = selectedUnit?.artifacts?.railpack_plan;
		if (!plan) return "";
		try {
			return JSON.stringify(plan, null, 2);
		} catch {
			return String(plan);
		}
	}, [selectedUnit]);

	const openArtifact = React.useCallback(
		(artifact: PreviewArtifact) => {
			switch (artifact.action) {
				case "openBranch":
					setEditor({ kind: "branch" });
					return;
				case "openCompose":
					setEditor({ kind: "compose" });
					return;
				case "openDockerfile":
					setEditor({ kind: "dockerfile", unitName: primaryUnitName });
					return;
				case "openInfra":
					setEditor({ kind: "infra" });
					return;
				case "openEnvVars":
					setEditor({ kind: "envVars" });
					return;
				case "openNginx":
					setEditor({ kind: "nginx" });
					return;
				case "openCustomDomain":
					setEditor({ kind: "customDomain" });
					return;
				default:
					return;
			}
		},
		[primaryUnitName]
	);

	const warningsByStep = React.useMemo(() => groupWarningsByStep(model.warnings), [model.warnings]);

	const regionSelectOptions = React.useMemo(() => {
		const v = (deployment.awsRegion || "").trim() || defaultAwsRegionForDeploy();
		if (AWS_REGION_OPTIONS.some((o) => o.value === v)) return AWS_REGION_OPTIONS;
		return [{ value: v, label: `Other (${v})` }, ...AWS_REGION_OPTIONS];
	}, [deployment.awsRegion]);

	return {
		model,
		artifactsByStep,
		warningsByStep,
		editor,
		setEditor,
		openArtifact,
		deployUnits,
		selectedUnit,
		railpackPlanJson,
		regionSelectOptions,
		deployment,
		onUpdateDeployment,
		subdomainDraft,
		customUrlStatus,
		customUrlVerifying,
		customUrlSaving,
		isCustomUrlDirty,
		updateSubdomainDraft,
		handleSaveCustomUrl,
		handleCancelCustomUrl,
	};
}
