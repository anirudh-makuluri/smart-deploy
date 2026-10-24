"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { PLATFORM_SIGN_OUT_ERROR, signOutPlatform } from "@/lib/platformSignOut";

const FAILED_TO_GET_SESSION = "FAILED_TO_GET_SESSION";

function extractErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;
	const direct = record.code;
	if (typeof direct === "string") return direct;

	const nested = record.error;
	if (nested && typeof nested === "object") {
		const nestedCode = (nested as Record<string, unknown>).code;
		if (typeof nestedCode === "string") return nestedCode;
	}

	return undefined;
}

/**
 * Recover a broken session only after server-side sign-out succeeds.
 */
export function SessionFailureLogoutGuard() {
	const attemptRef = useRef<Promise<void> | null>(null);
	const { error } = authClient.useSession();
	const errorCode = extractErrorCode(error);
	const router = useRouter();

	useEffect(() => {
		if (errorCode !== FAILED_TO_GET_SESSION) return;
		let active = true;
		let retryAvailable = false;
		let notification: string | number | undefined;
		const recover = () => {
			// Strict Mode replay observes the same request; explicit retry starts a new one.
			attemptRef.current ??= signOutPlatform();
			void attemptRef.current.then(() => {
				if (!active) return;
				router.replace("/auth");
				router.refresh();
			}, () => {
				if (!active) return;
				retryAvailable = true;
				notification = toast.error(PLATFORM_SIGN_OUT_ERROR, {
					duration: Infinity,
					action: { label: "Retry sign-out", onClick: () => {
						if (!active || !retryAvailable) return;
						retryAvailable = false;
						attemptRef.current = null;
						recover();
					} },
				});
			});
		};
		recover();
		return () => {
			active = false;
			if (notification !== undefined) toast.dismiss(notification);
		};
	}, [errorCode, router]);

	return null;
}
