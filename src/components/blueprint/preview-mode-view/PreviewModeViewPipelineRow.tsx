import * as React from "react";
import type { PreviewArtifact, PreviewStepId, PreviewWarning } from "@/components/blueprint/preview-model";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import { PreviewModeViewPort } from "@/components/blueprint/preview-mode-view/PreviewModeViewPort";
import {
	getNodeVerb,
	getPreferredArtifactForStep,
} from "@/components/blueprint/preview-mode-view/utils";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

type PreviewModeViewPipelineRowProps = {
	model: PreviewModel;
	artifactsByStep: Record<PreviewStepId, PreviewArtifact[]>;
	warningsByStep: Record<PreviewStepId, PreviewWarning[]>;
	onOpenArtifact: (artifact: PreviewArtifact) => void;
};

export function PreviewModeViewPipelineRow({
	model,
	artifactsByStep,
	warningsByStep,
	onOpenArtifact,
}: PreviewModeViewPipelineRowProps) {
	return (
		<div className="flex w-full min-w-[min(100%,720px)] flex-row items-stretch justify-center gap-0">
			{model.steps.map((step, stepIndex) => {
				const stepArtifacts = artifactsByStep[step.id];
				const stepWarnings = warningsByStep[step.id];
				const hasWarnings = stepWarnings.length > 0;

				const nodeVerb = getNodeVerb(step.id, model.deployRoute);
				const nodeFace = hasWarnings ? "rgba(251,191,36,0.14)" : "rgba(15,23,42,0.92)";
				const nodePort = hasWarnings ? "rgba(180,83,9,0.55)" : "rgba(2,6,23,0.95)";
				const isFirst = stepIndex === 0;
				const isLast = stepIndex === model.steps.length - 1;

				return (
					<React.Fragment key={`spine-${step.id}`}>
						<div className="flex min-w-0 flex-1 flex-col items-stretch px-0.5">
							<div className="flex min-h-[92px] w-full items-center justify-center">
								<button
									type="button"
									onClick={() => {
										const preferred = getPreferredArtifactForStep(step.id, stepArtifacts);
										if (preferred) onOpenArtifact(preferred);
									}}
									className={cn(
										"relative z-10 w-full max-w-[200px] rounded-2xl px-3.5 py-3 text-left shadow-[0_20px_50px_rgba(0,0,0,0.45)] ring-1 transition",
										hasWarnings
											? "ring-amber-400/25 hover:ring-amber-400/35"
											: "ring-white/8 hover:ring-white/14"
									)}
									style={
										{
											["--node" as string]: nodeFace,
											["--port" as string]: nodePort,
										} as React.CSSProperties
									}
									title={step.description}
								>
									<div
										className={cn(
											"pointer-events-none absolute inset-0 rounded-2xl",
											hasWarnings
												? "bg-gradient-to-b from-amber-500/15 to-amber-950/25"
												: "bg-gradient-to-b from-slate-700/25 to-slate-950/80"
										)}
										aria-hidden
									/>
									<div className="relative z-10 flex items-start justify-between gap-2">
										<div className="min-w-0">
											<div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
												{step.id}
											</div>
											<div className="mt-1 text-[12px] font-semibold leading-snug tracking-tight text-white">{nodeVerb}</div>
										</div>
										<div className="shrink-0">
											{hasWarnings ? (
												<div className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-100 ring-1 ring-amber-400/25">
													<AlertTriangle className="size-3.5" />
													{stepWarnings.length}
												</div>
											) : (
												<div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-1 text-[10px] font-bold text-emerald-100 ring-1 ring-emerald-400/20">
													<CheckCircle2 className="size-3.5" />
													OK
												</div>
											)}
										</div>
									</div>
									{!isFirst ? <PreviewModeViewPort position="left" /> : null}
									{!isLast ? <PreviewModeViewPort position="right" /> : null}
									<PreviewModeViewPort position="bottom" />
								</button>
							</div>
						</div>
						{!isLast ? (
							<div className="flex w-7 shrink-0 flex-col justify-center self-stretch pt-1">
								<div className="h-px w-full rounded-full bg-gradient-to-r from-white/15 via-white/25 to-white/15" />
							</div>
						) : null}
					</React.Fragment>
				);
			})}
		</div>
	);
}
