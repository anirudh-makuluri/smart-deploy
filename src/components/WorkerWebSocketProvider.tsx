"use client";

import * as React from "react";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";

type WorkerWebSocketContextValue = ReturnType<typeof useWorkerWebSocketSession>;

const WorkerWebSocketContext = React.createContext<WorkerWebSocketContextValue | null>(null);

export function WorkerWebSocketProvider({ children }: { children: React.ReactNode }) {
	const sessionValue = useWorkerWebSocketSession();

	const {
		deployLogEntries,
		latestAgentEvent,
		runAgent,
		socketStatus,
		sendDeployConfig,
		liveDeployConfig,
		deployStatus,
		deployError,
		deployCompleteEvent,
		initiateServiceLogs,
		clearDeploymentLogs,
		serviceLogs,
	} = sessionValue;

	const value = React.useMemo(
		() => ({
			deployLogEntries,
			latestAgentEvent,
			runAgent,
			socketStatus,
			sendDeployConfig,
			liveDeployConfig,
			deployStatus,
			deployError,
			deployCompleteEvent,
			initiateServiceLogs,
			clearDeploymentLogs,
			serviceLogs,
		}),
		[
			deployLogEntries,
			latestAgentEvent,
			runAgent,
			socketStatus,
			sendDeployConfig,
			liveDeployConfig,
			deployStatus,
			deployError,
			deployCompleteEvent,
			initiateServiceLogs,
			clearDeploymentLogs,
			serviceLogs,
		]
	);

	return <WorkerWebSocketContext.Provider value={value}>{children}</WorkerWebSocketContext.Provider>;
}

export function useWorkerWebSocket(): WorkerWebSocketContextValue {
	const ctx = React.use(WorkerWebSocketContext);
	if (!ctx) {
		throw new Error("useWorkerWebSocket must be used within WorkerWebSocketProvider");
	}
	return ctx;
}
