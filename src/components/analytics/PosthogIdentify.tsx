"use client";

import { useSession } from "next-auth/react";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

/**
 * Binds NextAuth user to PostHog when signed in; resets on sign-out.
 */
export function PosthogIdentify() {
	const { data: session, status } = useSession();
	const posthog = usePostHog();

	useEffect(() => {
		if (status === "loading") return;
		const id = session?.userID;
		if (id) {
			posthog.identify(id, {
				email: session?.user?.email ?? undefined,
				name: session?.user?.name ?? undefined,
			});
		} else {
			posthog.reset();
		}
	}, [posthog, session?.user?.email, session?.user?.name, session?.userID, status]);

	return null;
}
