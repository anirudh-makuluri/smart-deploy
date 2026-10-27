"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { WorkspaceCreated, WorkspaceList, teamKey, workspaceRequest, WorkspaceBrowserError } from "@/lib/apps/workspaceBrowser";
import { useWorkspaceAction } from "./useWorkspaceAction";
import { SharingBusy, SharingError, SharingFormInput, SharingPanel, SharingSubmit } from "./SharingUi";
import { WorkspaceApps } from "./WorkspaceApps";

export function WorkspaceManagement({ principal }: { principal: { id: string; email: string } }) {
	const { data: session, isPending } = authClient.useSession();
	if (isPending) return <SharingBusy />;
	if (!session || !session.user.emailVerified || session.user.id !== principal.id || session.user.email !== principal.email) return <p role="alert" className="text-sm text-muted-foreground">Your account changed. Reload this page before managing apps.</p>;
	return <div className="ph-no-capture ph-mask"><ManagedWorkspaces key={principal.id + principal.email} actorId={principal.id} /></div>;
}
function ManagedWorkspaces({ actorId }: { actorId: string }) {
	const cache = useQueryClient(); const action = useWorkspaceAction(); const [name, setName] = useState(""); const [selected, setSelected] = useState("");
	const list = useQuery({ queryKey: [...teamKey(actorId), "workspaces"], queryFn: ({ signal }) => workspaceRequest("/api/workspaces", "GET", null, WorkspaceList, signal), retry: false });
	async function refresh() { await cache.invalidateQueries({ queryKey: teamKey(actorId) }); action.reset(); }
	if (list.isPending) return <SharingBusy />;
	if (list.isError) return <SharingError message="Your workspaces couldn't be loaded." retry={() => void refresh()} />;
	const workspaces = list.data.workspaces.filter(row => row.role !== "member"); const workspace = workspaces.find(row => row.id === selected) ?? workspaces[0] ?? null;
	return <div className="space-y-7"><SharingPanel title="Workspace"><div className="grid items-end gap-6 md:grid-cols-2">
		<div className="space-y-3"><label htmlFor="managed-workspace" className="block text-sm font-medium">Manage workspace</label><select id="managed-workspace" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={workspace?.id ?? ""} onChange={event => setSelected(event.target.value)} disabled={!workspace}>{!workspace ? <option value="">Create a team workspace</option> : null}{workspaces.map(row => <option key={row.id} value={row.id}>{row.name} · {row.role}</option>)}</select><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={action.state.status === "pending"}>Refresh workspace</Button></div>
		<form className="space-y-3" action={async () => { await action.run(async signal => { const receipt = await workspaceRequest("/api/workspaces", "POST", { name: name.trim() }, WorkspaceCreated, signal); if (receipt.workspace.ownerId !== actorId || receipt.workspace.kind !== "team" || receipt.workspace.name !== name.trim()) throw new WorkspaceBrowserError(503); await cache.invalidateQueries({ queryKey: teamKey(actorId) }); if (!signal.aborted) { setName(""); setSelected(receipt.workspace.id); } }); }}><SharingFormInput id="new-workspace-name" label="New team workspace" type="text" maxLength={120} value={name} onChange={setName} disabled={action.state.status === "pending"} /><SharingSubmit label="Create workspace" disabled={action.state.status !== "idle"} /></form>
	</div>{action.state.status === "failed" ? <div className="mt-4"><SharingError message={action.state.message} retry={() => void refresh()} /></div> : null}</SharingPanel>
		{workspace ? <WorkspaceApps key={workspace.id} actorId={actorId} workspace={workspace} /> : <p className="text-sm text-muted-foreground">Only workspace owners and admins manage apps here. App-use colleagues should open the published link shared with them.</p>}
	</div>;
}
