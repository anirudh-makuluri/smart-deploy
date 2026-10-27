"use client";
import { useEffect, useRef, useState } from "react";
import { WorkspaceBrowserError } from "@/lib/apps/workspaceBrowser";
type WorkspaceActionState = { status: "idle" | "pending" } | { status: "failed"; message: string };
export function useWorkspaceAction() {
	const [state, setState] = useState<WorkspaceActionState>({ status: "idle" }); const active = useRef<AbortController | null>(null);
	useEffect(() => () => { const controller = active.current; active.current = null; controller?.abort(); }, []);
	async function run(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
		if (active.current || state.status === "failed") return;
		const controller = new AbortController(); active.current = controller; setState({ status: "pending" });
		try { await action(controller.signal); if (!controller.signal.aborted) setState({ status: "idle" }); }
		catch (error) { if (!controller.signal.aborted) setState({ status: "failed", message: error instanceof WorkspaceBrowserError ? error.message : new WorkspaceBrowserError(503).message }); }
		finally { if (active.current === controller) active.current = null; }
	}
	return { state, run, reset: () => { if (!active.current) setState({ status: "idle" }); } };
}
