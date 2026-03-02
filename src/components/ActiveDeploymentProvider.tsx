"use client";

import * as React from "react";
import { getActiveDeployment, clearActiveDeployment, getWebSocketUrl } from "@/custom-hooks/useDeployLogs";
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";

type LogsModalState = { deploymentId: string; userID?: string } | null;

const ActiveDeploymentContext = React.createContext<{
	openLogsModal: (deploymentId: string, userID?: string) => void;
	closeLogsModal: () => void;
}>({
	openLogsModal: () => {},
	closeLogsModal: () => {},
});

export function useActiveDeployment() {
	return React.useContext(ActiveDeploymentContext);
}

function ActiveDeploymentNotification() {
	const { openLogsModal } = useActiveDeployment();
	const [active, setActive] = React.useState<{
		deploymentId: string;
		userID?: string;
	} | null>(() => getActiveDeployment());

	// Poll sessionStorage so we hide the notification once it's cleared (e.g. by useDeployLogs on deploy_complete)
	React.useEffect(() => {
		const tick = () => setActive(getActiveDeployment());
		const id = setInterval(tick, 2000);
		return () => clearInterval(id);
	}, []);

	// When notification is visible but user may have refreshed, proactively check deployment status
	// so we clear sessionStorage when the deploy has finished (server already sent deploy_complete to no one)
	React.useEffect(() => {
		if (!active) return;
		const ws = new WebSocket(getWebSocketUrl());
		const timeout = window.setTimeout(() => {
			ws.close();
		}, 15000);
		ws.onopen = () => {
			ws.send(
				JSON.stringify({
					type: "get_deploy_logs",
					payload: { deploymentId: active.deploymentId, userID: active.userID },
				})
			);
		};
		ws.onmessage = (e) => {
			try {
				const data = JSON.parse(e.data as string);
				if (data.type === "deploy_logs_snapshot" && data.payload?.status) {
					if (data.payload.status === "success" || data.payload.status === "error") {
						clearActiveDeployment();
						setActive(null);
						window.clearTimeout(timeout);
						ws.close();
					}
				}
			} catch {
				// ignore
			}
		};
		ws.onerror = () => {
			window.clearTimeout(timeout);
			ws.close();
		};
		ws.onclose = () => {
			window.clearTimeout(timeout);
		};
		return () => {
			window.clearTimeout(timeout);
			ws.close();
		};
	}, [active?.deploymentId, active?.userID]);

	if (!active) return null;

	return (
		<button
			type="button"
			onClick={() => openLogsModal(active.deploymentId, active.userID)}
			className="fixed top-0 left-0 right-0 z-100 flex cursor-pointer items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium shadow-md hover:bg-primary/90 transition-colors"
		>
			<Loader2 className="size-4 animate-spin shrink-0" />
			<span>Deployment in progress</span>
			<span className="opacity-85">— Click to view logs</span>
		</button>
	);
}

function DeployLogsModalContent({
	deploymentId,
	onClose,
}: {
	deploymentId: string;
	userID?: string;
	onClose: () => void;
}) {
	const { deployStatus, deployError, serviceLogs, deployLogEntries } = useDeployLogs(
		undefined,
		deploymentId
	);

	return (
		<>
			<div className="flex items-center justify-between gap-4 pr-8">
				<h2 className="text-lg font-semibold text-foreground">
					Deployment logs
					{deployStatus === "running" && (
						<span className="ml-2 inline-flex items-center gap-1 text-sm font-normal text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							In progress
						</span>
					)}
				</h2>
				<Button variant="ghost" size="icon" onClick={onClose} className="absolute top-4 right-4">
					<X className="size-5" />
				</Button>
			</div>
			<div className="mt-4 min-h-[50vh] max-h-[70vh] overflow-hidden flex flex-col rounded-xl border border-border bg-card p-4">
				<DeployLogsView
					showDeployLogs={true}
					deployLogEntries={deployLogEntries}
					serviceLogs={serviceLogs}
					deployStatus={deployStatus}
					deployError={deployError}
				/>
			</div>
			<div className="mt-4 flex justify-end">
				<Button variant="outline" onClick={onClose}>
					Close
				</Button>
			</div>
		</>
	);
}

function DeployLogsModal({ state, onClose }: { state: LogsModalState; onClose: () => void }) {
	if (!state) return null;

	return (
		<div className="fixed inset-0 z-110 flex items-center justify-center p-4">
			<div
				className="absolute inset-0 bg-black/60"
				aria-hidden
				onClick={onClose}
			/>
			<div className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
				<DeployLogsModalContent
					deploymentId={state.deploymentId}
					userID={state.userID}
					onClose={onClose}
				/>
			</div>
		</div>
	);
}

export default function ActiveDeploymentProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const [logsModal, setLogsModal] = React.useState<LogsModalState>(null);

	const openLogsModal = React.useCallback(
		(deploymentId: string, userID?: string) => {
			setLogsModal({ deploymentId, userID });
		},
		[]
	);
	const closeLogsModal = React.useCallback(() => setLogsModal(null), []);

	const ctx = React.useMemo(
		() => ({ openLogsModal, closeLogsModal }),
		[openLogsModal, closeLogsModal]
	);

	return (
		<ActiveDeploymentContext.Provider value={ctx}>
			{children}
			<ActiveDeploymentNotification />
			<DeployLogsModal state={logsModal} onClose={closeLogsModal} />
		</ActiveDeploymentContext.Provider>
	);
}
