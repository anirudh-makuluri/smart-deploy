export const INVITATION_PATH = "/apps/invitations";
export type InvitationCapture = { status: "loading" | "missing" | "invalid" } | { status: "ready"; token: string };
const LOADING: InvitationCapture = { status: "loading" };

export function invitationLink(origin: string, token: string): string {
	const url = new URL(origin);
	if (url.protocol !== "https:" || url.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(token) || token.trim() !== token) throw Error("Invitation link unavailable.");
	return origin + INVITATION_PATH + "#token=" + token;
}
export function parseInvitationFragment(fragment: string): InvitationCapture {
	if (!fragment) return { status: "missing" };
	const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
	return match && match[0] === fragment ? { status: "ready", token: match[1] } : { status: "invalid" };
}

/** Capture once at subscription, then keep the secret only in this mounted store.
 * Subscription replay preserves it after the address has been scrubbed. */
export function createInvitationCaptureStore(capture: () => InvitationCapture = () => {
	const result = parseInvitationFragment(window.location.hash);
	window.history.replaceState(window.history.state, "", INVITATION_PATH);
	return result;
}) {
	let snapshot = LOADING;
	return {
		subscribe(listener: () => void) { if (snapshot.status === "loading") { snapshot = capture(); listener(); } return () => {}; },
		getSnapshot: () => snapshot,
		getServerSnapshot: () => LOADING,
	};
}
