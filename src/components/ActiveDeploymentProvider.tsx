"use client";

import * as React from "react";
import { getActiveDeployment, clearActiveDeployment, getWebSocketUrl } from "@/custom-hooks/useDeployLogs";
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";
import type { DeployStep } from "@/app/types";

type PrefetchedDeployLogs = {
	steps: DeployStep[];
	status?: "running" | "success" | "error";
	error?: string | null;
};

type LogsModalState = { repoName: string; serviceName: string; userID?: string; prefetched?: PrefetchedDeployLogs } | null;

const ActiveDeploymentContext = React.createContext<{
	openLogsModal: (repoName: string, serviceName: string, userID?: string, prefetched?: PrefetchedDeployLogs) => void;
	closeLogsModal: () => void;
}>({
	openLogsModal: () => { },
	closeLogsModal: () => { },
});

export function useActiveDeployment() {
	return React.useContext(ActiveDeploymentContext);
}

function ActiveDeploymentNotification() {
	const { openLogsModal } = useActiveDeployment();
	const [active, setActive] = React.useState<{
		repoName: string;
		serviceName: string;
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
					payload: { repoName: active.repoName, serviceName: active.serviceName, userID: active.userID },
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
	}, [active?.repoName, active?.serviceName, active?.userID]);

	if (!active) return null;

	return (
		<button
			type="button"
			onClick={() => openLogsModal(active.repoName, active.serviceName, active.userID)}
			className="fixed top-0 left-0 right-0 z-100 flex cursor-pointer items-center justify-center gap-2 py-2.5 px-4 bg-primary text-primary-foreground text-sm font-medium shadow-md hover:bg-primary/90 transition-colors"
		>
			<Loader2 className="size-4 animate-spin shrink-0" />
			<span>Deployment in progress</span>
			<span className="opacity-85">— Click to view logs</span>
		</button>
	);
}

function DeployLogsModalContent({
	repoName,
	serviceName,
	prefetched,
	onClose,
}: {
	repoName: string;
	serviceName: string;
	userID?: string;
	prefetched?: PrefetchedDeployLogs;
	onClose: () => void;
}) {
	const { deployStatus, deployError, serviceLogs, deployLogEntries } = useDeployLogs(
		serviceName,
		repoName
	);

	const fallbackEntries = React.useMemo(() => {
		if (!prefetched?.steps?.length) return [] as { timestamp?: string; message?: string }[];
		const entries: { timestamp?: string; message?: string }[] = [];
		for (const step of prefetched.steps) {
			for (const log of step.logs ?? []) {
				entries.push({
					timestamp: step.endedAt ?? step.startedAt,
					message: log,
				});
			}
		}
		return entries;
	}, [prefetched]);

	const effectiveDeployLogEntries = deployLogEntries.length > 0 ? deployLogEntries : fallbackEntries;
	const effectiveStatus = deployStatus === "not-started" && prefetched?.status ? prefetched.status : deployStatus;
	const effectiveError = deployError ?? prefetched?.error ?? null;

	return (
		<>
			<div className="flex items-center justify-between gap-4 pr-8">
				<h2 className="text-lg font-semibold text-foreground">
					Deployment logs
					{effectiveStatus === "running" && (
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
					deployLogEntries={effectiveDeployLogEntries}
					serviceLogs={serviceLogs}
					deployStatus={effectiveStatus}
					deployError={effectiveError}
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
					repoName={state.repoName}
					serviceName={state.serviceName}
					userID={state.userID}
					prefetched={state.prefetched}
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
		(repoName: string, serviceName: string, userID?: string, prefetched?: PrefetchedDeployLogs) => {
			setLogsModal({ repoName, serviceName, userID, prefetched });
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
