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
	const reducedMotion = Boolean(prefersReducedMotion);
	const [ref, inView] = useInView<HTMLDivElement>();
	const spotlightRef = React.useRef<HTMLSpanElement>(null);
	const animated = useAnimatedNumber({
		to: value,
		durationMs: 1600,
		enabled: inView,
		reducedMotion,
		round: true,
		ease: "out(3)",
		onComplete: React.useCallback(() => {}, []),
	});

	const moveSpotlight = React.useCallback(
		(clientX: number, clientY: number) => {
			const card = ref.current;
			const spotlight = spotlightRef.current;
			if (!card || !spotlight) return;
			const rect = card.getBoundingClientRect();
			const x = clientX - rect.left;
			const y = clientY - rect.top;
			spotlight.style.opacity = "1";
			spotlight.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
		},
		[ref]
	);

	const hideSpotlight = React.useCallback(() => {
		const spotlight = spotlightRef.current;
		if (!spotlight) return;
		spotlight.style.opacity = "0";
	}, []);

	const handleMouseMove = React.useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (reducedMotion) return;
			moveSpotlight(event.clientX, event.clientY);
		},
		[moveSpotlight, reducedMotion]
	);

	const handleMouseLeave = React.useCallback(() => {
		hideSpotlight();
	}, [hideSpotlight]);

	return (
		<div
			ref={ref}
			className="landing-stat-card"
			onMouseMove={reducedMotion ? undefined : handleMouseMove}
			onMouseLeave={reducedMotion ? undefined : handleMouseLeave}
		>
			<span ref={spotlightRef} className="landing-stat-spotlight" aria-hidden />
			<p className="relative z-10 font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
				{prefix}
				{formatLandingCount(animated)}
				{suffix}
			</p>
			<p className="relative z-10 mt-2 text-sm text-muted-foreground">{label}</p>
		</div>
	);
}
