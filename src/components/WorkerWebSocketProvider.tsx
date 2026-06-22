"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";

type WorkerWebSocketContextValue = ReturnType<typeof useWorkerWebSocketSession>;

const WorkerWebSocketContext = React.createContext<WorkerWebSocketContextValue | null>(null);

export function WorkerWebSocketProvider({ children }: { children: React.ReactNode }) {
	const { data: session } = authClient.useSession();

	const connectionEnabled = Boolean(session?.user?.id);

	const sessionValue = useWorkerWebSocketSession({
		connectionEnabled
	});

	const {
		deployLogEntries,
		socketStatus,
		sendDeployConfig,
		openSocket,
		liveDeployConfig,
		deployStatus,
		deployError,
		initiateServiceLogs,
		serviceLogs,
		setOnDeployFinished,
	} = sessionValue;

	const value = React.useMemo(
		() => ({
			deployLogEntries,
			socketStatus,
			sendDeployConfig,
			openSocket,
			liveDeployConfig,
			deployStatus,
			deployError,
			initiateServiceLogs,
			serviceLogs,
			setOnDeployFinished
		}),
		[
			deployLogEntries,
			socketStatus,
			sendDeployConfig,
			openSocket,
			liveDeployConfig,
			deployStatus,
			deployError,
			initiateServiceLogs,
			serviceLogs,
			setOnDeployFinished,
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
