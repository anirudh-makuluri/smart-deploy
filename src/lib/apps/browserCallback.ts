import { z } from "zod";
import type { BrowserLoginRequest } from "./browserLogin";
import type { AppUseIdentity } from "./appStore";

const Receipt = z.strictObject({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	callbackUrl: z.string().max(300), expiresAt: z.iso.datetime({ offset: true }) });

/** Browser-only POST; the assertion confirms display identity, never grants authority. */
export async function confirmAppLogin(input: BrowserLoginRequest, expectedIdentity: AppUseIdentity, origin: string, signal: AbortSignal): Promise<string> {
	const response = await fetch("/api/apps/handoff", { method: "POST", headers: { "Content-Type": "application/json" },
		credentials: "same-origin", cache: "no-store", redirect: "error", signal, body: JSON.stringify({ ...input, expectedIdentity }) });
	if (response.status !== 200 || response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
		throw new Error("App sign-in could not be confirmed.");
	}
	const receipt = Receipt.safeParse(await response.json());
	if (!receipt.success || signal.aborted) throw new Error("App sign-in could not be confirmed.");
	const value = receipt.data;
	const remaining = new Date(value.expiresAt).getTime() - Date.now();
	const destination = new URL(origin);
	if (destination.protocol !== "https:" || destination.origin !== origin || destination.username || destination.password
		|| value.callbackUrl !== origin + "/__smartdeploy/callback" || value.state !== input.state || remaining <= 0 || remaining > 120000) {
		throw new Error("App sign-in could not be confirmed.");
	}
	const callback = new URL(value.callbackUrl);
	callback.searchParams.set("code", value.code);
	callback.searchParams.set("state", value.state);
	return callback.href;
}

export function openAppCallback(url: string): void { window.location.replace(url); }
