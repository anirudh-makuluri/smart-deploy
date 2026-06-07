"use client";

import * as React from "react";
import { buildPreviewModel, type PreviewArtifact } from "@/components/blueprint/preview-model";
import { AWS_REGION_OPTIONS } from "@/components/blueprint/blueprint-fields";
import { defaultRegionForDeploy } from "@/lib/deployInfraDefaults";
import { updateCustomDomain } from "@/lib/graphqlClient";
import { sanitizeSubdomain } from "@/lib/utils";
import { toast } from "sonner";
import type {
	Editor,
	HostedSubdomainEditorState,
	HostedSubdomainStatus,
	PreviewModeViewProps,
} from "@/components/blueprint/preview-mode-view/types";
import {
	getHostedUrlFromSubdomain,
	groupByStep,
	groupWarningsByStep,
	mapCustomDomainError,
	savedHostedSubdomain,
} from "@/components/blueprint/preview-mode-view/utils";

export function usePreviewModeView({
	deployment,
	scanResults,
	onUpdateDeployment,
}: PreviewModeViewProps) {
	const model = React.useMemo(() => buildPreviewModel({ deployment, scanResults }), [deployment, scanResults]);
	const artifactsByStep = React.useMemo(() => groupByStep(model.artifacts), [model.artifacts]);
	const [editor, setEditor] = React.useState<Editor>(null);

	const hostedSubdomainVerifying = false;
	const [hostedSubdomainSaving, setHostedSubdomainSaving] = React.useState(false);
	const [hostedSubdomainEditor, setHostedSubdomainEditor] = React.useState<HostedSubdomainEditorState | null>(null);

	const savedSubdomain = React.useMemo(
		() => savedHostedSubdomain(deployment.hostedSubdomain),
		[deployment.hostedSubdomain]
	);

	const savedHostedSubdomainKey = deployment.hostedSubdomain ?? "";
	const isEditingHostedSubdomain = editor?.kind === "customDomain";
	const hostedSubdomainEditorMatchesDeployment =
		isEditingHostedSubdomain &&
		hostedSubdomainEditor !== null &&
		hostedSubdomainEditor.hostedSubdomain === savedHostedSubdomainKey;
	const hostedSubdomainDraft = hostedSubdomainEditorMatchesDeployment
		? hostedSubdomainEditor.draft
		: savedSubdomain;
	const hostedSubdomainStatus = hostedSubdomainEditorMatchesDeployment
		? hostedSubdomainEditor.status
		: { type: null };

	const updateHostedSubdomainDraft = React.useCallback(
		(draft: string, status: HostedSubdomainStatus = { type: null }) => {
			setHostedSubdomainEditor({ hostedSubdomain: savedHostedSubdomainKey, draft, status });
		},
		[savedHostedSubdomainKey]
	);

	const isHostedSubdomainDirty = hostedSubdomainDraft !== savedSubdomain;

	const handleSaveHostedSubdomain = React.useCallback(async () => {
		const trimmed = hostedSubdomainDraft.trim();
		const finalUrl = getHostedUrlFromSubdomain(trimmed);
		const previousSubdomain = savedHostedSubdomain(deployment.hostedSubdomain);
		const nextSubdomain = trimmed ? sanitizeSubdomain(trimmed) : "";
		if (nextSubdomain === previousSubdomain) return;

		setHostedSubdomainSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repoName, deployment.serviceName, finalUrl);
			await onUpdateDeployment({ hostedSubdomain: nextSubdomain || null });
			updateHostedSubdomainDraft(hostedSubdomainDraft, {
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
			updateHostedSubdomainDraft(hostedSubdomainDraft, { type: "error", message });
			toast.error(message);
		} finally {
			setHostedSubdomainSaving(false);
		}
	}, [
		deployment.hostedSubdomain,
		deployment.repoName,
		deployment.serviceName,
		hostedSubdomainDraft,
		onUpdateDeployment,
		updateHostedSubdomainDraft,
	]);

	const handleCancelHostedSubdomain = React.useCallback(() => {
		updateHostedSubdomainDraft(savedSubdomain);
	}, [savedSubdomain, updateHostedSubdomainDraft]);

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
		const v = (deployment.region || "").trim() || defaultRegionForDeploy();
		if (AWS_REGION_OPTIONS.some((o) => o.value === v)) return AWS_REGION_OPTIONS;
		return [{ value: v, label: `Other (${v})` }, ...AWS_REGION_OPTIONS];
	}, [deployment.region]);

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
		hostedSubdomainDraft,
		hostedSubdomainStatus,
		hostedSubdomainVerifying,
		hostedSubdomainSaving,
		isHostedSubdomainDirty,
		updateHostedSubdomainDraft,
		handleSaveHostedSubdomain,
		handleCancelHostedSubdomain,
	};
}
