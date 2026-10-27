import { z } from "zod";

const Details = z.object({ workspace: z.object({ id: z.uuid(), name: z.string().min(1).max(120) }), role: z.enum(["owner", "admin", "member"]) });
const Inspection = Details.extend({ role: z.enum(["admin", "member"]), expiresAt: z.iso.datetime({ offset: true }) });
export type InvitationReview = z.infer<typeof Inspection>;
export type InvitationReceipt = z.infer<typeof Details>;
export class InvitationBrowserError extends Error {
	constructor(readonly status: number) { super(status === 401 ? "Sign in again to review this invitation." : status === 403 ? "Use the invitation's verified email address. Administrator invitations also need platform approval." : status === 410 ? "This invitation has expired, was revoked, or has already been used. Ask for a fresh link." : "Invitation unavailable. Please try again."); }
}
export async function requestInvitation(action: "inspect", token: string, signal: AbortSignal): Promise<InvitationReview>;
export async function requestInvitation(action: "accept", token: string, signal: AbortSignal): Promise<InvitationReceipt>;
export async function requestInvitation(action: "inspect" | "accept", token: string, signal: AbortSignal): Promise<InvitationReview | InvitationReceipt> {
	if (token.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(token) || signal.aborted) throw new InvitationBrowserError(400);
	const controller = new AbortController(); const abort = () => controller.abort();
	signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 8000);
	try {
		const response = await fetch(`/api/workspace-invitations/${action}`, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
			headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal });
		if (!response.ok) throw new InvitationBrowserError(response.status);
		const value: unknown = await response.json(); controller.signal.throwIfAborted();
		return action === "inspect" ? Inspection.parse(value) : Details.parse(value);
	} catch (error) { if (error instanceof InvitationBrowserError) throw error; throw new InvitationBrowserError(503); }
	finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
