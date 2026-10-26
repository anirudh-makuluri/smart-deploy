"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { LoginForm } from "@/components/login-form";
import { Button } from "@/components/ui/button";
import { createInvitationCaptureStore, INVITATION_PATH } from "@/lib/apps/invitationLink";
import { InvitationBrowserError, requestInvitation, type InvitationReceipt, type InvitationReview } from "@/lib/apps/invitationBrowser";

export function WorkspaceInvitation() {
	const [store] = useState(createInvitationCaptureStore);
	const capture = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
	const { data: session, isPending } = authClient.useSession();
	if (capture.status === "loading" || isPending) return <p role="status">Preparing your invitation…</p>;
	if (capture.status !== "ready") return <InvitationNotice message="Open the complete invitation link your workspace shared with you." />;
	const callbackURL = INVITATION_PATH + "#token=" + capture.token;
	if (!session) return <><p className="text-sm leading-6 text-muted-foreground">Sign in with the account your workspace invited. You can review the workspace and role before joining.</p><LoginForm callbackURL={callbackURL} /></>;
	if (!session.user.emailVerified) return <><InvitationNotice message="A verified email address is required. Sign in with a verified account matching the invitation." /><LoginForm callbackURL={callbackURL} /></>;
	return <ReviewInvitation key={`${session.user.id}:${session.user.email}:${capture.token}`} token={capture.token} email={session.user.email} callbackURL={callbackURL} />;
}

type ReviewState = { status: "loading" } | { status: "ready" | "accepting" | "uncertain"; invitation: InvitationReview } | { status: "failed"; message: string; signin: boolean } | { status: "joined"; receipt: InvitationReceipt };
function ReviewInvitation({ token, email, callbackURL }: { token: string; email: string; callbackURL: string }) {
	const [state, setState] = useState<ReviewState>({ status: "loading" });
	const operation = useRef<AbortController | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		void requestInvitation("inspect", token, controller.signal).then(invitation => {
			if (!controller.signal.aborted) setState({ status: "ready", invitation });
		}).catch(failure => {
			if (!controller.signal.aborted) setState({ status: "failed", message: failure instanceof InvitationBrowserError ? failure.message : "Invitation unavailable. Reopen the link to try again.", signin: failure instanceof InvitationBrowserError && (failure.status === 401 || failure.status === 403) });
		});
		return () => { controller.abort(); operation.current?.abort(); };
	}, [token]);
	async function join() {
		if (operation.current || state.status !== "ready") return;
		const controller = new AbortController(); operation.current = controller; setState({ status: "accepting", invitation: state.invitation });
		try {
			const receipt = await requestInvitation("accept", token, controller.signal);
			if (receipt.workspace.id !== state.invitation.workspace.id) throw new InvitationBrowserError(503);
			if (!controller.signal.aborted) setState({ status: "joined", receipt });
		} catch {
			if (!controller.signal.aborted) setState({ status: "uncertain", invitation: state.invitation });
		} finally { operation.current = null; }
	}
	if (state.status === "loading") return <p role="status">Reviewing your invitation…</p>;
	if (state.status === "failed") return <><InvitationNotice message={state.message} />{state.signin ? <LoginForm callbackURL={callbackURL} /> : null}</>;
	if (state.status === "joined") return <div role="status" className="space-y-4"><h2 className="text-2xl font-semibold tracking-tight">You’ve joined {state.receipt.workspace.name}.</h2><p className="text-sm leading-6 text-muted-foreground">Your role is {state.receipt.role}. App access is granted separately. Ask your workspace owner for access and the published app link.</p></div>;
	const pending = state.status === "accepting";
	return <div className="space-y-6">
		<div className="rounded-xl border border-border bg-background/70 p-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Workspace</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{state.invitation.workspace.name}</h2><dl className="mt-5 grid gap-3 text-sm"><div><dt className="text-muted-foreground">Join as</dt><dd className="mt-1 font-medium capitalize">{state.invitation.role}</dd></div><div><dt className="text-muted-foreground">Signed in as</dt><dd className="mt-1 break-all font-medium">{email}</dd></div><div><dt className="text-muted-foreground">Invitation expires</dt><dd className="mt-1"><time dateTime={state.invitation.expiresAt}>{new Date(state.invitation.expiresAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></dd></div></dl></div>
		<p className="text-sm leading-6 text-muted-foreground">{state.invitation.role === "member" ? "Members can use published apps that the workspace grants them. Joining does not grant deployment, management or preview access." : "Administrators can manage this workspace and its apps. Platform management still requires approval."}</p>
		{state.status === "uncertain" ? <p role="alert" className="text-sm text-destructive">We couldn&apos;t confirm acceptance. It may have completed; ask your workspace owner to check membership before trying again.</p> : null}
		<Button className="landing-build-blue h-11 w-full" disabled={state.status !== "ready"} onClick={() => void join()}>{pending ? "Joining…" : "Join workspace"}</Button>
		<Link href="/" prefetch={false} onClick={() => operation.current?.abort()} className="block text-center text-sm text-muted-foreground underline underline-offset-4">Cancel</Link>
	</div>;
}
function InvitationNotice({ message }: { message: string }) { return <p role="alert" className="text-sm leading-6 text-muted-foreground">{message}</p>; }
