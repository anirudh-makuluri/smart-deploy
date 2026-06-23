import * as React from "react";
import { useWorkerWebSocket } from "@/components/WorkerWebSocketProvider";
import { useSystemHealth } from "@/custom-hooks/useSystemHealth";
import type { SystemHealthService, SystemHealthStatus } from "@/custom-hooks/useSystemHealth";

export type HeaderSystemHealth = {
	status: SystemHealthStatus;
	message: string;
	services: SystemHealthService[];
};

export function useHeaderSystemHealth(): HeaderSystemHealth {
	const workerWs = useWorkerWebSocket();
	const artifactsHealth = useSystemHealth();

	return React.useMemo((): HeaderSystemHealth => {
		const workerOnline = workerWs.socketStatus === "open";
		const wsRow: SystemHealthService = {
			name: "WebSocket server",
			status: workerOnline ? "healthy" : "unavailable",
			message:
				workerWs.socketStatus === "open"
					? "Connected to deploy worker"
					: workerWs.socketStatus === "connecting"
						? "Connecting to deploy worker..."
						: workerWs.socketStatus === "closed"
							? "Disconnected from deploy worker"
							: "Deploy worker unreachable",
		};

		const services: SystemHealthService[] = [wsRow, ...artifactsHealth.services];
		const wsOk = workerOnline;
		const artifactsOk =
			artifactsHealth.services.length > 0 && artifactsHealth.services.every((s) => s.status === "healthy");

		if (workerWs.socketStatus === "connecting" || artifactsHealth.status === "checking") {
			return { status: "checking", message: "Checking system health", services };
		}

		if (artifactsHealth.status === "unavailable" && artifactsHealth.services.length === 0) {
			return { status: "unavailable", message: artifactsHealth.message, services };
		}

		if (wsOk && artifactsOk) {
			return { status: "healthy", message: "All systems online", services };
		}

		return { status: "degraded", message: "One or more services need attention", services };
	}, [workerWs.socketStatus, artifactsHealth]);
}

export function systemHealthStatusClass(status: SystemHealthStatus): string {
	if (status === "healthy") {
		return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
	}
	if (status === "degraded" || status === "unavailable") {
		return "border-destructive/30 bg-destructive/10 text-destructive";
	}
	return "border-border/60 bg-secondary/40 text-muted-foreground";
}
