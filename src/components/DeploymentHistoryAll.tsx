"use client";

import * as React from "react";
import { formatTimestamp } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, GitBranch, GitCommit, History, Loader2 } from "lucide-react";

type DeploymentHistoryAllEntry = {
	id: string;
	deploymentId: string;
	timestamp: string;
	success: boolean;
	steps: { id: string; label: string; logs: string[]; status: string }[];
	configSnapshot: Record<string, unknown>;
	commitSha?: string;
	commitMessage?: string;
	branch?: string;
	durationMs?: number;
	serviceName: string;
	repoUrl?: string;
};

export default function DeploymentHistoryAll() {
	const [history, setHistory] = React.useState<DeploymentHistoryAllEntry[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		setLoading(true);
		setError(null);
		fetch("/api/deployment-history/all")
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "success" && Array.isArray(data.history)) {
					setHistory(data.history);
				} else {
					setError(data.message || "Failed to load history");
				}
			})
			.catch((err) => setError(err?.message || "Failed to load history"))
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<div className="rounded-lg border border-border bg-card p-6 flex items-center gap-3 text-muted-foreground">
				<Loader2 className="size-5 animate-spin" />
				<span>Loading deployment history…</span>
			</div>
		);
	}

	if (error) {
		return (
			<Alert className="border-destructive/50 bg-destructive/10 text-muted-foreground">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		);
	}

	if (history.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-card p-6 text-muted-foreground text-sm">
				<p className="flex items-center gap-2">
					<History className="size-4" />
					No deployment history yet. Deploy once to see success/failure logs here.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card overflow-hidden">
			<Accordion type="multiple" className="w-full">
				{history.map((entry) => (
					<AccordionItem
						key={entry.id}
						value={entry.id}
						className="border-border px-4"
					>
						<AccordionTrigger className="text-foreground hover:no-underline hover:text-muted-foreground py-3">
							<div className="flex flex-col gap-2.5 text-left w-full">
								<div className="flex items-center gap-3 flex-wrap">
									<span className="text-sm font-medium">{formatTimestamp(entry.timestamp)}</span>
									<Badge
										variant="outline"
										className={
											entry.success
												? "border-primary/60 text-primary bg-primary/10"
												: "border-amber-400/60 text-amber-400 bg-amber-400/10"
										}
									>
										{entry.success ? "Success" : "Failed"}
									</Badge>
									{entry.durationMs && (
										<span className="text-xs text-muted-foreground flex items-center gap-1">
											<Clock className="size-3" />
											{(entry.durationMs / 1000 / 60).toFixed(1)}m
										</span>
									)}
								</div>
								<div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
									<span className="font-medium text-foreground">{entry.serviceName}</span>
									{entry.repoUrl && (
										<span className="truncate">{entry.repoUrl}</span>
									)}
								</div>
								{(entry.commitSha || entry.branch) && (
									<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
										{entry.commitSha && (
											<div className="flex items-center gap-1.5 bg-background px-2 py-1 rounded border border-border/50">
												<GitCommit className="size-3" />
												<code className="font-mono">{entry.commitSha.substring(0, 7)}</code>
											</div>
										)}
										{entry.branch && (
											<div className="flex items-center gap-1.5 bg-background px-2 py-1 rounded border border-border/50">
												<GitBranch className="size-3" />
												<span className="font-medium text-foreground">{entry.branch}</span>
											</div>
										)}
									</div>
								)}
							</div>
						</AccordionTrigger>
						<AccordionContent className="pb-4">
							<div className="space-y-4">
								<div>
									<p className="text-xs font-medium text-muted-foreground mb-2">Logs</p>
									<ScrollArea className="h-48 rounded-md border border-border bg-background p-3">
										<div className="space-y-3 text-xs font-mono text-muted-foreground">
											{entry.steps.map((step) => (
												<div key={step.id}>
													<p className="font-semibold text-foreground mb-1">
														{step.label} ({step.status})
														{(step.startedAt || step.endedAt) && (
															<span className="text-muted-foreground font-normal ml-1">
																— {step.endedAt
																	? new Date(step.endedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
																	: new Date(step.startedAt!).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
															</span>
														)}
													</p>
													{(step.logs || []).length > 0 ? (
														<pre className="whitespace-pre-wrap wrap-break-word text-muted-foreground">
															{step.logs.join("\n")}
														</pre>
													) : (
														<span className="italic">No logs</span>
													)}
												</div>
											))}
										</div>
									</ScrollArea>
								</div>
							</div>
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</div>
	);
}
