"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InvitationCreated, InvitationList, teamKey, workspaceRequest, WorkspaceAck, WorkspaceBrowserError, type UiInvitation, type UiWorkspaceAccess } from "@/lib/apps/workspaceBrowser";
import { invitationLink } from "@/lib/apps/invitationLink";
import { useWorkspaceAction } from "./useWorkspaceAction";
import { SharingBusy, SharingError, SharingFormInput, SharingPanel, SharingSubmit } from "./SharingUi";

export function WorkspaceInvitationCreator({ actorId, workspace }: { actorId: string; workspace: UiWorkspaceAccess }) {
	return <SharingPanel title="Invite colleagues">{workspace.kind === "team" ? <TeamInvitations actorId={actorId} workspace={workspace} /> : <p className="text-sm text-muted-foreground">Create a team workspace to invite colleagues.</p>}</SharingPanel>;
}
function TeamInvitations({ actorId, workspace }: { actorId: string; workspace: UiWorkspaceAccess }) {
	const cache = useQueryClient(); const base = `/api/workspaces/${workspace.id}/invitations`; const action = useWorkspaceAction();
	const [email, setEmail] = useState(""); const [link, setLink] = useState<{ id: string; url: string; email: string } | null>(null);
	const list = useQuery({ queryKey: [...teamKey(actorId), workspace.id, "invitations"], queryFn: ({ signal }) => workspaceRequest(base, "GET", null, InvitationList, signal), retry: false });
	async function refresh() { await cache.invalidateQueries({ queryKey: teamKey(actorId) }); action.reset(); }
	async function create(signal: AbortSignal) {
		setLink(null); const expected = email.trim().toLowerCase();
		const receipt = await workspaceRequest(base, "POST", { email: expected, role: "member" }, InvitationCreated, signal);
		if (receipt.invitation.email !== expected) throw new WorkspaceBrowserError(503);
		await cache.invalidateQueries({ queryKey: teamKey(actorId) });
		if (!signal.aborted) setLink({ id: receipt.invitation.id, url: invitationLink(window.location.origin, receipt.invitation.token), email: receipt.invitation.email });
	}
	const linkAvailable = link && !list.isError && list.data?.invitations.some(invitation => invitation.id === link.id);
	return <div className="space-y-5">
		<p className="text-sm leading-6 text-muted-foreground">Invite a member with a link. They must sign in with this verified email. Joining alone does not grant app access.</p>
		<form className="space-y-3" action={async () => { await action.run(create); }}>
			<SharingFormInput id="colleague-email" label="Colleague email" type="email" maxLength={254} value={email} onChange={setEmail} disabled={action.state.status === "pending"} />
			<SharingSubmit label="Create invitation" disabled={action.state.status !== "idle" || list.isPending || list.isError} />
		</form>
		{action.state.status === "failed" ? <SharingError message={action.state.message} retry={() => void refresh()} /> : null}
		{linkAvailable && action.state.status !== "failed" ? <InvitationLinkCard key={link.id} url={link.url} email={link.email} /> : null}
		<PendingInvitations pending={list.isPending} error={list.isError} items={list.data?.invitations ?? []} role={workspace.role} busy={action.state.status !== "idle"} retry={() => void refresh()} revoke={id => void action.run(async signal => { await workspaceRequest(`${base}/${id}`, "DELETE", null, WorkspaceAck, signal); setLink(null); await cache.invalidateQueries({ queryKey: teamKey(actorId) }); })} />
	</div>;
}
function InvitationLinkCard({ url, email }: { url: string; email: string }) {
	const [copy, setCopy] = useState("");
	async function copyLink() { try { await navigator.clipboard.writeText(url); setCopy("Copied"); } catch { setCopy("Select and copy the link from the field."); } }
	return <div className="ph-no-capture ph-mask space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"><p className="break-all text-sm">Invitation for {email}</p><Input aria-label="Invitation link" type="password" readOnly value={url} /><Button variant="outline" size="sm" onClick={() => void copyLink()}>Copy invitation link</Button>{copy ? <p role="status" className="text-xs text-muted-foreground">{copy}</p> : null}<p className="text-xs text-muted-foreground">This link is shown once. Creating a replacement revokes the previous pending link for that email.</p></div>;
}
interface PendingInvitationsProps { pending: boolean; error: boolean; items: UiInvitation[]; role: UiWorkspaceAccess["role"]; busy: boolean; retry: () => void; revoke: (id: string) => void }
function PendingInvitations({ pending, error, items, role, busy, retry, revoke }: PendingInvitationsProps) {
	if (pending) return <SharingBusy />;
	if (error) return <SharingError message="Invitations couldn't be loaded." retry={retry} />;
	return <ul className="divide-y divide-border">{items.map(invitation => <li key={invitation.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-all text-sm">{invitation.email}</p><p className="text-xs text-muted-foreground">Pending {invitation.role} invitation</p></div>{invitation.role === "member" || role === "owner" ? <Button variant="outline" size="sm" disabled={busy} aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => revoke(invitation.id)}>Revoke</Button> : <span className="text-xs text-muted-foreground">Owner-managed</span>}</li>)}</ul>;
}
