"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";
import { Button } from "@/components/ui/button";
import { useDemoExpiry } from "@/custom-hooks/useDemoExpiry";
import type { RuntimeControlRequest, RuntimeControlView } from "@/lib/apps/runtimeControlProtocol";
import { teamKey, type UiApp } from "@/lib/apps/workspaceBrowser";
import { SharingError, SharingPanel } from "./SharingUi";
import { useWorkspaceAction } from "./useWorkspaceAction";

type RuntimeDispatcher = ReturnType<typeof useWorkerWebSocket>["requestAppRuntime"];
type RuntimeEnvironment = "preview" | "published";
type RuntimeSelection = RuntimeControlView["selected"][number];
export function RuntimePublishing({ actorId, app }: { actorId: string; app: UiApp }) {
	const { socketStatus, requestAppRuntime } = useWorkerWebSocket();
	return <SharingPanel title="Preview & publish">{socketStatus === "open" ? <ConnectedRuntimePublishing actorId={actorId} app={app} dispatch={requestAppRuntime} /> : <p role="status" className="text-sm text-muted-foreground">{socketStatus === "connecting" ? "Connecting to publishing…" : "The publishing server is offline. Check again when the demo is running."}</p>}</SharingPanel>;
}
function ConnectedRuntimePublishing({ actorId, app, dispatch }: { actorId: string; app: UiApp; dispatch: RuntimeDispatcher }) {
	const cache = useQueryClient(); const action = useWorkspaceAction(); const key = [...teamKey(actorId), app.workspaceId, "runtime-control", app.id];
	const state = useQuery({ queryKey: key, queryFn: ({ signal }) => dispatch(actorId, { action: "inspect", requestId: crypto.randomUUID(), appId: app.id }, signal), retry: false, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
	const expired = useDemoExpiry(state.data?.expiresAt ?? 0);
	async function refresh() { await cache.invalidateQueries({ queryKey: key, exact: true }); action.reset(); }
	async function select(environment: RuntimeEnvironment, releaseId: string) {
		await action.run(async signal => {
			const current = state.data?.selected.find(row => row.environment === environment);
			const request: RuntimeControlRequest = { action: "activate", requestId: crypto.randomUUID(), appId: app.id, environment, releaseId, expectedCurrentId: current?.runtimeId ?? null };
			const view = await dispatch(actorId, request, signal); signal.throwIfAborted(); cache.setQueryData(key, view); await cache.invalidateQueries({ queryKey: key, exact: true });
		});
	}
	if (state.isPending || state.isFetching) return <p role="status" className="text-sm text-muted-foreground">Checking prepared releases…</p>;
	if (state.isError) return <SharingError message="Publishing isn't available for this app right now." retry={() => void refresh()} />;
	if (expired) return <p role="status" className="text-sm text-muted-foreground">This demo window has ended.</p>;
	const disabled = action.state.status !== "idle";
	return <div className="space-y-6">
		<p className="text-sm leading-6 text-muted-foreground">Publishing selects a prepared release. Preview data and secrets stay separate from the published app.</p>
		<PublishedControls view={state.data} disabled={disabled} select={releaseId => void select("published", releaseId)} />
		<PreviewControls view={state.data} disabled={disabled} select={releaseId => void select("preview", releaseId)} />
		{action.state.status === "pending" ? <p role="status" className="text-sm text-muted-foreground">Checking and selecting the release…</p> : null}
		{action.state.status === "failed" ? <SharingError message={action.state.message} retry={() => void refresh()} /> : null}
		<p className="text-xs leading-5 text-muted-foreground">Demo ends {new Date(state.data.expiresAt).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC. A selected release may take a few seconds to appear.</p>
		<Button variant="outline" size="sm" disabled={action.state.status === "pending"} onClick={() => void refresh()}>Refresh releases</Button>
	</div>;
}
function PublishedControls({ view, disabled, select }: { view: RuntimeControlView; disabled: boolean; select: (releaseId: string) => void }) {
	const [chosen, setChosen] = useState(""); const choices = view.choices.filter(row => row.environment === "published"); const current = view.selected.find(row => row.environment === "published");
	const choice = choices.find(row => row.releaseId === chosen) ?? choices.find(row => row.available && row.releaseId !== current?.releaseId) ?? choices.find(row => row.releaseId === current?.releaseId) ?? choices[0] ?? null;
	return <div className="space-y-3"><label htmlFor="published-release" className="block text-sm font-medium">Published release</label><select id="published-release" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={disabled || !choice} value={choice?.releaseId ?? ""} onChange={event => setChosen(event.target.value)}>{choices.map(row => <option key={row.releaseId} value={row.releaseId} disabled={!row.available}>{row.label}{row.available ? "" : " · unavailable"}</option>)}</select>
		<Button disabled={disabled || !choice?.available || choice.releaseId === current?.releaseId} onClick={() => { if (choice) select(choice.releaseId); }}>Publish release</Button>
		{current?.available ? <RuntimeLink key={current.runtimeId} selection={current} /> : <p className="text-xs text-muted-foreground">There is no published selection available to open.</p>}
	</div>;
}
function PreviewControls({ view, disabled, select }: { view: RuntimeControlView; disabled: boolean; select: (releaseId: string) => void }) {
	const choice = view.choices.find(row => row.environment === "preview"); const current = view.selected.find(row => row.environment === "preview");
	return <div className="space-y-3 border-t border-border pt-5"><h3 className="text-sm font-medium">Owner/admin preview</h3><p className="text-xs text-muted-foreground">App-use colleagues can open only the published app.</p>
		{choice ? <Button variant="outline" disabled={disabled || !choice.available || choice.releaseId === current?.releaseId} onClick={() => select(choice.releaseId)}>Select preview</Button> : null}
		{current?.available ? <RuntimeLink key={current.runtimeId} selection={current} /> : null}
	</div>;
}
function RuntimeLink({ selection }: { selection: RuntimeSelection }) {
	const [copy, setCopy] = useState(""); const published = selection.environment === "published";
	async function copyLink() { try { await navigator.clipboard.writeText(selection.origin); setCopy("Copied"); } catch { setCopy("Select and copy the link below."); } }
	return <div className="ph-no-capture ph-mask space-y-3 rounded-xl border border-border p-3"><p className="break-all text-xs text-muted-foreground">{selection.origin}</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href={selection.origin} target="_blank" rel="noopener noreferrer">{published ? "Open published app" : "Open preview"}</a></Button>{published ? <Button variant="outline" size="sm" onClick={() => void copyLink()}>Copy published link</Button> : null}</div>{copy ? <p role="status" className="text-xs text-muted-foreground">{copy}</p> : null}</div>;
}
