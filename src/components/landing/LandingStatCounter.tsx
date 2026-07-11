"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { useAnimatedNumber } from "@/lib/landing/useAnimatedNumber";
import { formatLandingCount } from "@/lib/landing/landingCopy";
import { useInView } from "@/lib/landing/useInView";

type LandingStatCounterProps = {
	value: number;
	label: string;
	prefix: string;
	suffix: string;
};

/** Animated count-up stat that starts when scrolled into view. */
export function LandingStatCounter({ value, label, prefix, suffix }: LandingStatCounterProps) {
	const prefersReducedMotion = useReducedMotion();
	const [ref, inView] = useInView<HTMLDivElement>();
	const animated = useAnimatedNumber({
		to: value,
		durationMs: 1600,
		enabled: inView,
		reducedMotion: Boolean(prefersReducedMotion),
		round: true,
		ease: "out(3)",
		onComplete: React.useCallback(() => {}, []),
	});

	return (
		<div ref={ref} className="landing-stat-card">
			<span className="landing-stat-glow" aria-hidden />
			<p className="relative font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
				{prefix}
				{formatLandingCount(animated)}
				{suffix}
			</p>
			<p className="relative mt-2 text-sm text-muted-foreground">{label}</p>
		</div>
	);
}
