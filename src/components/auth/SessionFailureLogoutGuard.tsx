"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const FAILED_TO_GET_SESSION = "FAILED_TO_GET_SESSION";
const AUTH_COOKIE_NAMES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
	"better-auth.session_data",
	"__Secure-better-auth.session_data",
	"better-auth.dont_remember",
	"__Secure-better-auth.dont_remember",
];

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

function clearAuthCookies() {
	if (typeof document === "undefined" || typeof window === "undefined") return;

	const hostname = window.location.hostname;
	const parts = hostname.split(".");
	const domains = new Set<string>([hostname, `.${hostname}`]);

	if (parts.length >= 2) {
		for (let i = 0; i <= parts.length - 2; i += 1) {
			const candidate = parts.slice(i).join(".");
			domains.add(candidate);
			domains.add(`.${candidate}`);
		}
	}

	for (const name of AUTH_COOKIE_NAMES) {
		document.cookie = `${name}=; Max-Age=0; path=/`;
		for (const domain of domains) {
			document.cookie = `${name}=; Max-Age=0; path=/; domain=${domain}`;
		}
	}
}

/**
 * If session retrieval is broken, force sign-out to recover from a stuck auth state.
 */
export function SessionFailureLogoutGuard() {
	const router = useRouter();
	const hasTriggeredRef = useRef(false);
	const { error } = authClient.useSession();

	useEffect(() => {
		if (hasTriggeredRef.current) return;
		if (extractErrorCode(error) !== FAILED_TO_GET_SESSION) return;

		hasTriggeredRef.current = true;
		void (async () => {
			try {
				await authClient.signOut();
			} catch {
				// Continue with redirect even when sign-out request fails.
			}
			clearAuthCookies();
			router.replace("/auth");
			router.refresh();
		})();
	}, [error, router]);

	return null;
}
