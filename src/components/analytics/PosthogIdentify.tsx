"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Binds authenticated user to PostHog when signed in; resets on sign-out.
 */
export function PosthogIdentify() {
	const { data: session, isPending } = authClient.useSession();
	const posthog = usePostHog();

	useEffect(() => {
		if (isPending) return;
		const id = session?.user?.id;
		if (id) {
			posthog.identify(id, {
				email: session?.user?.email ?? undefined,
				name: session?.user?.name ?? undefined,
			});
		} else {
			posthog.reset();
		}
	}, [isPending, posthog, session?.user?.email, session?.user?.id, session?.user?.name]);

	return null;
}
