"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { useAppData } from "@/store/useAppData";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";

type WorkerWebSocketContextValue = ReturnType<typeof useWorkerWebSocketSession>;

const WorkerWebSocketContext = React.createContext<WorkerWebSocketContextValue | null>(null);

export function WorkerWebSocketProvider({ children }: { children: React.ReactNode }) {
	const { data: session } = authClient.useSession();
	const activeRepo = useAppData((s) => s.activeRepo);
	const activeServiceName = useAppData((s) => s.activeServiceName);

	const connectionEnabled = Boolean(session?.user?.id);
	const repoName = activeRepo?.name ?? "";
	const serviceName = activeServiceName ?? "";

	const value = useWorkerWebSocketSession({
		connectionEnabled,
		repoName,
		serviceName,
		announceActiveDeployments: true,
	});

	return <WorkerWebSocketContext.Provider value={value}>{children}</WorkerWebSocketContext.Provider>;
}

export function useWorkerWebSocket(): WorkerWebSocketContextValue {
	const ctx = React.useContext(WorkerWebSocketContext);
	if (!ctx) {
		throw new Error("useWorkerWebSocket must be used within WorkerWebSocketProvider");
	}
	return ctx;
}
