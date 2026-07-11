"use client";

import * as React from "react";
import { animate, type JSAnimation } from "animejs";

type UseAnimatedNumberOptions = {
	/** Animate toward this value while `enabled` is true. */
	to: number;
	durationMs: number;
	enabled: boolean;
	reducedMotion: boolean;
	/** Round the emitted value to an integer. Defaults to true. */
	round: boolean;
	ease: string;
	onComplete: () => void;
};

/**
 * Animates a number from 0 to `to` using anime.js, emitting each frame as React
 * state. Respects reduced motion (jumps to the end) and cleans up on unmount or
 * when the target changes, so advancing a phase mid-stream never glitches.
 */
export function useAnimatedNumber({
	to,
	durationMs,
	enabled,
	reducedMotion,
	round,
	ease,
	onComplete,
}: UseAnimatedNumberOptions): number {
	const [value, setValue] = React.useState(0);
	const onCompleteRef = React.useRef(onComplete);

	React.useEffect(() => {
		onCompleteRef.current = onComplete;
	});

	React.useEffect(() => {
		if (!enabled) return;

		const state = { n: 0 };
		const animation: JSAnimation = animate(state, {
			n: to,
			duration: reducedMotion ? 0 : durationMs,
			ease,
			modifier: round ? Math.round : (v: number) => v,
			onBegin: () => setValue(reducedMotion ? to : 0),
			onUpdate: () => setValue(state.n),
			onComplete: () => {
				setValue(to);
				onCompleteRef.current();
			},
		});

		return () => {
			animation.pause();
		};
	}, [to, durationMs, enabled, reducedMotion, round, ease]);

	return value;
}
