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

	const sessionValue = useWorkerWebSocketSession({
		connectionEnabled,
		repoName,
		serviceName,
		announceActiveDeployments: true,
	});

	const {
		steps,
		deployLogEntries,
		socketStatus,
		sendDeployConfig,
		sendRollbackRequest,
		openSocket,
		deployConfigRef,
		deployStatus,
		deployError,
		customDnsStatus,
		customDnsError,
		initiateServiceLogs,
		serviceLogs,
		hasConnectedOnce,
		setOnDeployFinished,
	} = sessionValue;

	const value = React.useMemo(
		() => ({
			steps,
			deployLogEntries,
			socketStatus,
			sendDeployConfig,
			sendRollbackRequest,
			openSocket,
			deployConfigRef,
			deployStatus,
			deployError,
			customDnsStatus,
			customDnsError,
			initiateServiceLogs,
			serviceLogs,
			hasConnectedOnce,
			setOnDeployFinished,
		}),
		[
			steps,
			deployLogEntries,
			socketStatus,
			sendDeployConfig,
			sendRollbackRequest,
			openSocket,
			deployConfigRef,
			deployStatus,
			deployError,
			customDnsStatus,
			customDnsError,
			initiateServiceLogs,
			serviceLogs,
			hasConnectedOnce,
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
