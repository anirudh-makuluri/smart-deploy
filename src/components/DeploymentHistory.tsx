"use client";

import * as React from "react";
import { formatTimestamp } from "@/lib/utils";
import type { DeploymentHistoryEntry } from "@/app/types";
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
import { HelpCircle, History, Loader2 } from "lucide-react";

export default function DeploymentHistory({ deploymentId }: { deploymentId: string }) {
	const [history, setHistory] = React.useState<DeploymentHistoryEntry[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [analyzingId, setAnalyzingId] = React.useState<string | null>(null);
	const [analysisByEntryId, setAnalysisByEntryId] = React.useState<Record<string, string>>({});

	React.useEffect(() => {
		if (!deploymentId) return;
		setLoading(true);
		setError(null);
		fetch(`/api/deployment-history?deploymentId=${encodeURIComponent(deploymentId)}`)
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "success" && Array.isArray(data.history)) {
					setHistory(data.history);
				} else {
					setError(data.message || "Failed to load history");
				}
			})
			.catch((err) => {
				setError(err?.message || "Failed to load history");
			})
			.finally(() => setLoading(false));
	}, [deploymentId]);

	const handleWhyDidItFail = React.useCallback(async (entry: DeploymentHistoryEntry) => {
		setAnalyzingId(entry.id);
		try {
			const res = await fetch("/api/llm/analyze-failure", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					steps: entry.steps,
					configSnapshot: entry.configSnapshot,
				}),
			});
			const data = await res.json();
			if (data.response) {
				setAnalysisByEntryId((prev) => ({ ...prev, [entry.id]: data.response }));
			} else {
				setAnalysisByEntryId((prev) => ({
					...prev,
					[entry.id]: data.error || data.details || "Analysis failed.",
				}));
			}
		} catch (err) {
			setAnalysisByEntryId((prev) => ({
				...prev,
				[entry.id]: err instanceof Error ? err.message : "Request failed.",
			}));
		} finally {
			setAnalyzingId(null);
		}
	}, []);

	if (loading) {
		return (
			<div className="rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/40 p-6 flex items-center gap-3 text-[#94a3b8]">
				<Loader2 className="size-5 animate-spin" />
				<span>Loading deployment history…</span>
			</div>
		);
	}

	if (error) {
		return (
			<Alert className="border-[#dc2626]/50 bg-[#dc2626]/10 text-[#94a3b8]">
				<AlertDescription>{error}</AlertDescription>
			</Alert>
		);
	}

	if (history.length === 0) {
		return (
			<div className="rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/40 p-6 text-[#94a3b8] text-sm">
				<p className="flex items-center gap-2">
					<History className="size-4" />
					No deployment history yet. Deploy once to see success/failure logs here.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-[#1e3a5f]/60 bg-[#132f4c]/40 overflow-hidden">
			<div className="px-4 py-3 border-b border-[#1e3a5f]/60">
				<h3 className="font-semibold text-[#e2e8f0] flex items-center gap-2">
					<History className="size-4" />
					Deployment history
				</h3>
			</div>
			<Accordion type="multiple" className="w-full">
				{history.map((entry) => (
					<AccordionItem
						key={entry.id}
						value={entry.id}
						className="border-[#1e3a5f]/60 px-4"
					>
						<AccordionTrigger className="text-[#e2e8f0] hover:no-underline hover:text-[#94a3b8] py-3">
							<div className="flex items-center gap-3 text-left">
								<span className="text-sm">{formatTimestamp(entry.timestamp)}</span>
								<Badge
									variant="outline"
									className={
										entry.success
											? "border-[#14b8a6]/60 text-[#14b8a6] bg-[#14b8a6]/10"
											: "border-[#f59e0b]/60 text-[#f59e0b] bg-[#f59e0b]/10"
									}
								>
									{entry.success ? "Success" : "Failed"}
								</Badge>
								{entry.deployUrl && entry.success && (
									<a
										href={entry.deployUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="text-xs text-[#14b8a6] hover:underline"
										onClick={(e) => e.stopPropagation()}
									>
										Open link
									</a>
								)}
							</div>
						</AccordionTrigger>
						<AccordionContent className="pb-4">
							<div className="space-y-4">
								{/* Step logs */}
								<div>
									<p className="text-xs font-medium text-[#94a3b8] mb-2">Logs</p>
									<ScrollArea className="h-48 rounded-md border border-[#1e3a5f]/60 bg-[#0c1929]/50 p-3">
										<div className="space-y-3 text-xs font-mono text-[#94a3b8]">
											{entry.steps.map((step) => (
												<div key={step.id}>
													<p className="font-semibold text-[#e2e8f0] mb-1">
														{step.label} ({step.status})
													</p>
													{(step.logs || []).length > 0 ? (
														<pre className="whitespace-pre-wrap break-words text-[#94a3b8]">
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
								{/* Why did it fail? for failed entries */}
								{!entry.success && (
									<div>
										<Button
											variant="outline"
											size="sm"
											className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50"
											onClick={() => handleWhyDidItFail(entry)}
											disabled={analyzingId === entry.id}
										>
											{analyzingId === entry.id ? (
												<>
													<Loader2 className="size-4 animate-spin mr-2" />
													Analyzing…
												</>
											) : (
												<>
													<HelpCircle className="size-4 mr-2" />
													Why did it fail?
												</>
											)}
										</Button>
										{analysisByEntryId[entry.id] && (
											<Alert className="mt-3 border-[#1e3a5f]/60 bg-[#132f4c]/60 text-[#e2e8f0]">
												<AlertDescription className="text-sm whitespace-pre-wrap">
													{analysisByEntryId[entry.id]}
												</AlertDescription>
											</Alert>
										)}
									</div>
								)}
							</div>
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</div>
	);
}
