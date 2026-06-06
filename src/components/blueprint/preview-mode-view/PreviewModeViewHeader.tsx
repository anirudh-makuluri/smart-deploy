type PreviewModeViewHeaderProps = {
	pipelineLabel: string;
};

export function PreviewModeViewHeader({ pipelineLabel }: PreviewModeViewHeaderProps) {
	return (
		<div className="rounded-3xl border border-white/6 bg-gradient-to-br from-white/6 via-white/2 to-transparent px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
						Preview · {pipelineLabel}
					</div>
					<div className="mt-1.5 text-base font-semibold tracking-tight text-white">
						What runs in each stage of this deploy
					</div>
					<p className="mt-1 max-w-xl text-sm leading-relaxed text-white/45">
						Pipeline runs left to right; under each stage is the config and files that stage uses. Click a step or a row to edit.
					</p>
				</div>
			</div>
		</div>
	);
}
