import { authClient } from "@/lib/auth-client";

export const PLATFORM_SIGN_OUT_ERROR = "Sign-out could not be completed. Please retry.";

/** A resolved SDK request can still contain a server-side revocation failure. */
export async function signOutPlatform(): Promise<void> {
	const result = await authClient.signOut();
	if (result.error) throw new Error(PLATFORM_SIGN_OUT_ERROR);
}
