"use client";

import type { DemoPhase } from "@/lib/landing/interactiveDemo";

const PHASE_X: Record<DemoPhase, string> = {
	idle: "14%",
	setup: "26%",
	scan: "45%",
	blueprint: "62%",
	deploy: "80%",
	complete: "92%",
};

/**
 * Static drafting-grid backdrop with a single amber survey line that tracks the
 * current demo phase. Replaces the WebGL glow orb — no blur, no glow, just a
 * precise blueprint field that reinforces the product metaphor.
 */
export function LandingBlueprintBackdrop({ phase }: { phase: DemoPhase }) {
	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 z-0">
			<div className="bp-hero-backdrop" />
			<div className="bp-scanline" style={{ left: PHASE_X[phase] }} />
		</div>
	);
}
