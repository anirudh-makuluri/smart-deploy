"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { GrantList, MemberList, teamKey, workspaceRequest, WorkspaceAck, type UiApp } from "@/lib/apps/workspaceBrowser";
import { useWorkspaceAction } from "./useWorkspaceAction";
import { SharingBusy, SharingError, SharingPanel } from "./SharingUi";

export function AppMemberAccess({ actorId, app }: { actorId: string; app: UiApp }) {
	const cache = useQueryClient(); const action = useWorkspaceAction(); const base = `/api/apps/${app.id}/grants`;
	const members = useQuery({ queryKey: [...teamKey(actorId), app.workspaceId, "members"], queryFn: ({ signal }) => workspaceRequest(`/api/workspaces/${app.workspaceId}/members`, "GET", null, MemberList, signal), retry: false });
	const grants = useQuery({ queryKey: [...teamKey(actorId), app.workspaceId, "grants", app.id], queryFn: ({ signal }) => workspaceRequest(base, "GET", null, GrantList, signal), retry: false });
	async function refresh() { await cache.invalidateQueries({ queryKey: teamKey(actorId) }); action.reset(); }
	if (members.isPending || grants.isPending) return <SharingBusy />;
	if (members.isError || grants.isError) return <SharingError message="Current app permissions couldn't be loaded." retry={() => void refresh()} />;
	const allowed = new Set(grants.data.grants.map(grant => grant.userId));
	return <SharingPanel title="App access"><div className="space-y-4">
		<p className="text-sm leading-6 text-muted-foreground">Choose which verified members can use {app.name}. Members use the published app; previews stay with workspace owners and admins.</p>
		{action.state.status === "failed" ? <SharingError message={action.state.message} retry={() => void refresh()} /> : null}
		<ul className="divide-y divide-border">{members.data.members.map(member => <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="break-all text-sm font-medium">{member.email}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{member.role}{member.role !== "member" ? " · inherited access" : allowed.has(member.userId) ? " · app access granted" : " · no app access"}</p></div>{member.role === "member" ? <Button variant={allowed.has(member.userId) ? "outline" : "default"} size="sm" disabled={action.state.status !== "idle"} aria-label={`${allowed.has(member.userId) ? "Revoke" : "Grant"} app access for ${member.email}`} onClick={() => void action.run(async signal => { await workspaceRequest(base, allowed.has(member.userId) ? "DELETE" : "POST", { userId: member.userId }, WorkspaceAck, signal); await cache.invalidateQueries({ queryKey: teamKey(actorId) }); })}>{allowed.has(member.userId) ? "Revoke access" : "Grant access"}</Button> : null}</li>)}</ul>
		<Button variant="outline" size="sm" onClick={() => void refresh()} disabled={action.state.status === "pending"}>Refresh members</Button>
	</div></SharingPanel>;
}
