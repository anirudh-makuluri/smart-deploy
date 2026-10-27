"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppCreated, AppList, teamKey, workspaceRequest, WorkspaceBrowserError, type UiWorkspaceAccess } from "@/lib/apps/workspaceBrowser";
import { useWorkspaceAction } from "./useWorkspaceAction";
import { SharingBusy, SharingError, SharingFormInput, SharingPanel, SharingSubmit } from "./SharingUi";
import { AppMemberAccess } from "./AppMemberAccess";
import { WorkspaceInvitationCreator } from "./WorkspaceInvitationCreator";
import { RuntimePublishing } from "./RuntimePublishing";

export function WorkspaceApps({ actorId, workspace, publishEnabled }: { actorId: string; workspace: UiWorkspaceAccess; publishEnabled: boolean }) {
	const cache = useQueryClient(); const action = useWorkspaceAction(); const [name, setName] = useState(""); const [selected, setSelected] = useState("");
	const base = `/api/workspaces/${workspace.id}/apps`;
	const list = useQuery({ queryKey: [...teamKey(actorId), workspace.id, "apps"], queryFn: async ({ signal }) => { const result = await workspaceRequest(base, "GET", null, AppList, signal); if (result.apps.some(app => app.workspaceId !== workspace.id)) throw new WorkspaceBrowserError(503); return result; }, retry: false });
	async function refresh() { await cache.invalidateQueries({ queryKey: teamKey(actorId) }); action.reset(); }
	if (list.isPending) return <SharingBusy />;
	if (list.isError) return <SharingError message="Workspace apps couldn't be loaded." retry={() => void refresh()} />;
	const app = list.data.apps.find(row => row.id === selected) ?? list.data.apps[0] ?? null;
	return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"><div className="space-y-6"><SharingPanel title="Apps">
		<div className="space-y-5"><label htmlFor="workspace-app" className="block text-sm font-medium">Select app</label><select id="workspace-app" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={app?.id ?? ""} onChange={event => setSelected(event.target.value)} disabled={!app}>{!app ? <option value="">No apps yet</option> : null}{list.data.apps.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
			<form className="space-y-3 border-t border-border pt-5" action={async () => { await action.run(async signal => { const receipt = await workspaceRequest(base, "POST", { name: name.trim() }, AppCreated, signal); if (receipt.app.workspaceId !== workspace.id || receipt.app.createdBy !== actorId || receipt.app.legacyDeploymentId !== null || receipt.app.name !== name.trim()) throw new WorkspaceBrowserError(503); await cache.invalidateQueries({ queryKey: teamKey(actorId) }); if (!signal.aborted) { setName(""); setSelected(receipt.app.id); } }); }}><SharingFormInput id="new-app-name" label="New app name" type="text" maxLength={120} value={name} onChange={setName} disabled={action.state.status === "pending"} /><SharingSubmit label="Create app" disabled={action.state.status !== "idle"} /></form>
			{action.state.status === "failed" ? <SharingError message={action.state.message} retry={() => void refresh()} /> : null}
			<p className="text-xs leading-5 text-muted-foreground">Creating an app reserves its workspace identity. Publishing is a separate step.</p>
		</div></SharingPanel><WorkspaceInvitationCreator actorId={actorId} workspace={workspace} /></div>
		<div className="space-y-6">{app ? <>{publishEnabled ? <RuntimePublishing key={"runtime-" + app.id} actorId={actorId} app={app} /> : null}<AppMemberAccess key={app.id} actorId={actorId} app={app} /></> : <SharingPanel title="App access"><p className="text-sm text-muted-foreground">Create an app, then invite colleagues and choose who can use it.</p></SharingPanel>}</div>
	</div>;
}
