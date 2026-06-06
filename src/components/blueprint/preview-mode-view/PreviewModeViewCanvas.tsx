import type { PreviewArtifact, PreviewStepId, PreviewWarning } from "@/components/blueprint/preview-model";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import type { SDDeployUnit } from "@/app/types";
import { PreviewModeViewConfigRow } from "@/components/blueprint/preview-mode-view/PreviewModeViewConfigRow";
import { PreviewModeViewPipelineRow } from "@/components/blueprint/preview-mode-view/PreviewModeViewPipelineRow";

type PreviewModeViewCanvasProps = {
	model: PreviewModel;
	artifactsByStep: Record<PreviewStepId, PreviewArtifact[]>;
	warningsByStep: Record<PreviewStepId, PreviewWarning[]>;
	deployUnits: SDDeployUnit[];
	onOpenArtifact: (artifact: PreviewArtifact) => void;
};

export function PreviewModeViewCanvas({
	model,
	artifactsByStep,
	warningsByStep,
	deployUnits,
	onOpenArtifact,
}: PreviewModeViewCanvasProps) {
	return (
		<div className="relative min-h-0 flex-1 overflow-auto rounded-3xl border border-white/6 bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(99,102,241,0.08),transparent_55%),radial-gradient(900px_480px_at_80%_40%,rgba(34,211,238,0.05),transparent_50%),rgba(6,8,14,0.94)] p-6 sm:p-8">
			<div className="dot-grid-bg pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
			<div className="relative flex min-w-0 flex-col gap-8">
				<PreviewModeViewPipelineRow
					model={model}
					artifactsByStep={artifactsByStep}
					warningsByStep={warningsByStep}
					onOpenArtifact={onOpenArtifact}
				/>
				<PreviewModeViewConfigRow
					model={model}
					artifactsByStep={artifactsByStep}
					warningsByStep={warningsByStep}
					deployUnits={deployUnits}
					onOpenArtifact={onOpenArtifact}
				/>
			</div>
		</div>
	);
}
