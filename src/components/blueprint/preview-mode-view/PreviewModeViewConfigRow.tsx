import * as React from "react";
import type { SDDeployUnit } from "@/app/types";
import type { PreviewArtifact, PreviewStepId, PreviewWarning } from "@/components/blueprint/preview-model";
import type { PreviewModel } from "@/components/blueprint/preview-model";
import { PreviewModeViewTrunk } from "@/components/blueprint/preview-mode-view/PreviewModeViewPort";
import { cn } from "@/lib/utils";

type PreviewModeViewConfigRowProps = {
	model: PreviewModel;
	artifactsByStep: Record<PreviewStepId, PreviewArtifact[]>;
	warningsByStep: Record<PreviewStepId, PreviewWarning[]>;
	deployUnits: SDDeployUnit[];
	onOpenArtifact: (artifact: PreviewArtifact) => void;
};

export function PreviewModeViewConfigRow({
	model,
	artifactsByStep,
	warningsByStep,
	deployUnits,
	onOpenArtifact,
}: PreviewModeViewConfigRowProps) {
	return (
		<div className="flex w-full min-w-[min(100%,720px)] flex-row items-start justify-center gap-0">
			{model.steps.map((step, stepIndex) => {
				const stepArtifacts = artifactsByStep[step.id];
				const stepWarnings = warningsByStep[step.id];
				const hasComposeDetails = step.id === "build" && model.composeBuildMode && deployUnits.length > 1;
				const hasExtra = stepWarnings.length > 0 || hasComposeDetails;
				const isLast = stepIndex === model.steps.length - 1;

				return (
					<React.Fragment key={`config-${step.id}`}>
						<div className="flex min-w-0 flex-1 flex-col items-center px-0.5">
							<PreviewModeViewTrunk className={cn("min-h-10 w-px shrink-0", hasExtra ? "h-10" : "h-6")} />
							<div className="mt-2 flex w-full max-w-[220px] flex-col gap-2">
								{stepArtifacts.length === 0 ? (
									<div className="rounded-xl bg-white/3 px-2.5 py-2 text-center text-[11px] text-white/35">
										No mapped inputs
									</div>
								) : (
									stepArtifacts.map((artifact) => (
										<button
											key={artifact.id}
											type="button"
											onClick={() => onOpenArtifact(artifact)}
											className={cn(
												"relative w-full rounded-xl px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-white/90 ring-1 ring-white/8 transition",
												"bg-white/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.25)]",
												"hover:bg-white/10 hover:ring-white/12",
												artifact.action ? "" : "cursor-default opacity-75 hover:opacity-90"
											)}
											title={artifact.subtitle ?? artifact.title}
										>
											<span className="block truncate text-white/55">{artifact.title}</span>
											{artifact.subtitle ? (
												<span className="mt-0.5 block truncate font-mono text-[10px] text-white/70">{artifact.subtitle}</span>
											) : null}
										</button>
									))
								)}

								{stepWarnings.slice(0, 3).map((w) => (
									<div
										key={w.id}
										className="relative w-full rounded-xl bg-amber-500/10 px-2.5 py-2 ring-1 ring-amber-400/20"
									>
										<div className="text-xs font-semibold text-amber-50">{w.title}</div>
										<div className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">{w.description}</div>
									</div>
								))}

								{hasComposeDetails ? (
									<div className="rounded-xl bg-white/5 px-2.5 py-2 ring-1 ring-white/8">
										<details className="group">
											<summary className="cursor-pointer select-none text-xs font-semibold text-white/90">
												Deploy units ({deployUnits.length})
											</summary>
											<div className="mt-2 grid gap-1.5">
												{deployUnits.map((unit) => (
													<div key={unit.name} className="rounded-lg bg-black/25 px-2 py-1.5 ring-1 ring-white/6">
														<div className="flex flex-wrap items-center justify-between gap-1">
															<div className="text-xs font-semibold text-white/90">{unit.name}</div>
															<div className="text-[10px] text-white/45">:{unit.port}</div>
														</div>
														<div className="mt-0.5 text-[10px] text-white/45">
															<span className="font-mono text-white/65">{unit.root}</span>
															{" · "}
															<span className="font-mono text-white/65">{unit.type}</span>
														</div>
													</div>
												))}
											</div>
										</details>
									</div>
								) : null}
							</div>
						</div>
						{!isLast ? <div className="w-7 shrink-0" aria-hidden /> : null}
					</React.Fragment>
				);
			})}
		</div>
	);
}
