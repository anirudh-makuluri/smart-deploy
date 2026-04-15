"use client";

import * as React from "react";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";
import DeployLogsView from "@/components/deploy-workspace/DeployLogsView";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";
import type { DeployStep } from "@/app/types";

export type DeploymentLogsModalPrefetched = {
	steps: DeployStep[];
	status?: "running" | "success" | "error";
	error?: string | null;
};

export type DeploymentLogsModalProps = {
	open: boolean;
	onClose: () => void;
	repoName: string;
	serviceName: string;
	prefetched?: DeploymentLogsModalPrefetched;
};

function DeploymentLogsModalContent({
	repoName,
	serviceName,
	prefetched,
	onClose,
}: {
	repoName: string;
	serviceName: string;
	prefetched?: DeploymentLogsModalPrefetched;
	onClose: () => void;
}) {
	const { deployStatus, deployError, serviceLogs, deployLogEntries } = useWorkerWebSocketSession({
		connectionEnabled: true,
		repoName,
		serviceName,
	});

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
					repoNameForLogs={repoName}
					serviceNameForLogs={serviceName}
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

export function DeploymentLogsModal({ open, onClose, repoName, serviceName, prefetched }: DeploymentLogsModalProps) {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-110 flex items-center justify-center p-4">
			<div
				className="absolute inset-0 bg-black/60"
				aria-hidden
				onClick={onClose}
			/>
			<div className="relative z-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-xl">
				<DeploymentLogsModalContent
					repoName={repoName}
					serviceName={serviceName}
					prefetched={prefetched}
					onClose={onClose}
				/>
			</div>
		</div>
	);
}
