"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import type { DemoPhase } from "@/lib/landing/interactiveDemo";

type LandingHeroBackgroundProps = {
	phase: DemoPhase;
};

const LandingHeroCanvas = dynamic(
	() => import("@/components/landing/LandingHeroCanvas").then((mod) => mod.LandingHeroCanvas),
	{ ssr: false }
);

/**
 * Defers the WebGL canvas until the browser is idle or the user interacts, so it
 * never blocks LCP. A static gradient renders immediately as the fallback. The
 * canvas freezes for reduced-motion users and pauses when the tab is hidden.
 */
export function LandingHeroBackground({ phase }: LandingHeroBackgroundProps) {
	const prefersReducedMotion = useReducedMotion();
	const [ready, setReady] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		const reveal = () => {
			if (!cancelled) setReady(true);
		};

		const idleWindow = window as typeof window & {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
			cancelIdleCallback?: (handle: number) => void;
		};

		let idleHandle: number | null = null;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
		if (typeof idleWindow.requestIdleCallback === "function") {
			idleHandle = idleWindow.requestIdleCallback(reveal, { timeout: 2000 });
		} else {
			timeoutHandle = setTimeout(reveal, 600);
		}

		const onInteract = () => reveal();
		window.addEventListener("pointerdown", onInteract, { once: true });
		window.addEventListener("scroll", onInteract, { once: true, passive: true });

		return () => {
			cancelled = true;
			if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
				idleWindow.cancelIdleCallback(idleHandle);
			}
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			window.removeEventListener("pointerdown", onInteract);
			window.removeEventListener("scroll", onInteract);
		};
	}, []);

	return (
		<div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-[#050505]">
			{ready && (
				<LandingHeroCanvas phase={phase} animate={!prefersReducedMotion} />
			)}
			<div
				className="absolute inset-0"
				style={{
					background:
						"radial-gradient(ellipse 82% 65% at 50% 36%, transparent 0%, rgba(5,5,5,0.35) 55%, rgba(5,5,5,0.9) 100%)",
				}}
			/>
		</div>
	);
}
