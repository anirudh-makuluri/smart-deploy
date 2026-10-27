import { RuntimeControlReply, RuntimeControlRequest, type RuntimeControlView } from "./runtimeControlProtocol";
import { WorkspaceBrowserError } from "./workspaceBrowser";

/** One caller-owned socket operation. No retries, credential storage or optimistic success. */
export async function requestRuntimeControl(payload: RuntimeControlRequest, signal: AbortSignal, current: () => boolean, send: () => Promise<unknown>): Promise<RuntimeControlView> {
	try {
		const command = RuntimeControlRequest.parse(payload); signal.throwIfAborted(); if (!current()) throw new WorkspaceBrowserError(503);
		const reply = RuntimeControlReply.parse(await send()); signal.throwIfAborted(); if (!current() || reply.requestId !== command.requestId) throw new WorkspaceBrowserError(503);
		if (!reply.ok) throw new WorkspaceBrowserError(reply.status);
		if (reply.appId !== command.appId) throw new WorkspaceBrowserError(503);
		const view = reply.view;
		const choices = new Map(view.choices.map(row => [row.releaseId, row]));
		if (new Set(view.selected.map(row => row.environment)).size !== view.selected.length || choices.size !== view.choices.length
			|| new Set(view.selected.map(row => row.origin)).size !== view.selected.length || view.selected.some(row => choices.get(row.releaseId)?.environment !== row.environment)) throw new WorkspaceBrowserError(503);
		if (command.action === "activate" && !view.selected.some(row => row.environment === command.environment && row.releaseId === command.releaseId)) throw new WorkspaceBrowserError(503);
		return view;
	} catch (error) { if (error instanceof WorkspaceBrowserError) throw error; throw new WorkspaceBrowserError(503); }
}
