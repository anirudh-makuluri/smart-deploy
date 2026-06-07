type ServiceLogsLoadingIndicatorProps = {
	visible: boolean;
};

export function ServiceLogsLoadingIndicator({ visible }: ServiceLogsLoadingIndicatorProps) {
	if (!visible) return null;

	return (
		<div
			className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1.5 rounded-full border border-border/60 bg-background/80 text-xs font-medium text-muted-foreground shadow-sm"
			aria-live="polite"
		>
			Loading older logs...
		</div>
	);
}
