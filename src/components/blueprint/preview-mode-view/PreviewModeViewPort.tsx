import { cn } from "@/lib/utils";

export function PreviewModeViewPort({
	position,
	className,
}: {
	position: "top" | "bottom" | "left" | "right";
	className?: string;
}) {
	const base =
		"pointer-events-none absolute z-20 h-2 w-2.5 rounded-[2px] bg-[var(--port)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
	const pos =
		position === "top"
			? "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2"
			: position === "bottom"
				? "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2"
				: position === "left"
					? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
					: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2";
	return <span aria-hidden className={cn(base, pos, className)} />;
}

export function PreviewModeViewTrunk({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none w-px shrink-0 bg-gradient-to-b from-white/18 via-white/10 to-white/5",
				className
			)}
		/>
	);
}
