"use client";

import { PreviewModeViewCanvas } from "@/components/blueprint/preview-mode-view/PreviewModeViewCanvas";
import { PreviewModeViewEditorSheet } from "@/components/blueprint/preview-mode-view/PreviewModeViewEditorSheet";
import { PreviewModeViewHeader } from "@/components/blueprint/preview-mode-view/PreviewModeViewHeader";
import type { PreviewModeViewProps } from "@/components/blueprint/preview-mode-view/types";
import { usePreviewModeView } from "@/components/blueprint/preview-mode-view/usePreviewModeView";

export default function PreviewModeView({
	deployment,
	scanResults,
	branchOptions,
	onUpdateDeployment,
	onUpdateScanResults: _onUpdateScanResults,
}: PreviewModeViewProps) {
	const view = usePreviewModeView({
		deployment,
		scanResults,
		branchOptions,
		onUpdateDeployment,
		onUpdateScanResults: _onUpdateScanResults,
	});

	return (
		<div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 p-6">
			<PreviewModeViewHeader pipelineLabel={view.model.pipelineLabel} />

			<PreviewModeViewCanvas
				model={view.model}
				artifactsByStep={view.artifactsByStep}
				warningsByStep={view.warningsByStep}
				deployUnits={view.deployUnits}
				onOpenArtifact={view.openArtifact}
			/>

			<PreviewModeViewEditorSheet
				editor={view.editor}
				onEditorChange={view.setEditor}
				deployment={view.deployment}
				model={view.model}
				branchOptions={branchOptions}
				deployUnits={view.deployUnits}
				selectedUnit={view.selectedUnit}
				railpackPlanJson={view.railpackPlanJson}
				regionSelectOptions={view.regionSelectOptions}
				onUpdateDeployment={view.onUpdateDeployment}
				hostedSubdomainDraft={view.hostedSubdomainDraft}
				hostedSubdomainStatus={view.hostedSubdomainStatus}
				hostedSubdomainVerifying={view.hostedSubdomainVerifying}
				hostedSubdomainSaving={view.hostedSubdomainSaving}
				isHostedSubdomainDirty={view.isHostedSubdomainDirty}
				onUpdateHostedSubdomainDraft={view.updateHostedSubdomainDraft}
				onSaveHostedSubdomain={view.handleSaveHostedSubdomain}
				onCancelHostedSubdomain={view.handleCancelHostedSubdomain}
				envVarsString={view.envVarsString}
				onSaveEnvVarsString={view.onSaveEnvVarsString}
			/>
		</div>
	);
}
