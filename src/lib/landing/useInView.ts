"use client";

import * as React from "react";

type UseInViewOptions = {
	/** Stop observing after the first intersection. Defaults to true. */
	once: boolean;
	rootMargin: string;
};

/**
 * Reports whether the referenced element has entered the viewport. Used to drive
 * scroll-triggered reveals and count-ups on the landing page.
 */
export function useInView<T extends HTMLElement>(
	options: UseInViewOptions = { once: true, rootMargin: "0px 0px -12% 0px" }
): [React.RefObject<T | null>, boolean] {
	const ref = React.useRef<T | null>(null);
	const [inView, setInView] = React.useState(false);

	React.useEffect(() => {
		const node = ref.current;
		if (!node) return;
		if (typeof IntersectionObserver === "undefined") {
			const frame = requestAnimationFrame(() => setInView(true));
			return () => cancelAnimationFrame(frame);
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setInView(true);
						if (options.once) observer.disconnect();
					} else if (!options.once) {
						setInView(false);
					}
				}
			},
			{ rootMargin: options.rootMargin, threshold: 0.15 }
		);

		observer.observe(node);
		return () => observer.disconnect();
	}, [options.once, options.rootMargin]);

	return [ref, inView];
}
