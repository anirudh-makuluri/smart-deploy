import { formatTimestamp } from "@/lib/utils";
import type { DeploymentHistoryEntry } from "@/app/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert } from "@/components/ui/alert";
import { AlertDescription } from "@/components/ui/alert-parts";
import { HelpCircle, Loader2, GitBranch, GitCommit, Clock, RotateCcw } from "lucide-react";
import { hasUsableReleaseArtifact } from "@/lib/deploymentReleaseArtifacts";

type DeploymentHistoryEntryItemProps = {
	entry: DeploymentHistoryEntry;
	isActiveRelease: boolean;
	analyzingId: string | null;
	analysisText?: string;
	rollbackingEntryId?: string | null;
	onWhyDidItFail: (entry: DeploymentHistoryEntry) => void;
	onRollback?: (entry: DeploymentHistoryEntry) => void;
};

export function DeploymentHistoryEntryItem({
	entry,
	isActiveRelease,
	analyzingId,
	analysisText,
	rollbackingEntryId,
	onWhyDidItFail,
	onRollback,
}: DeploymentHistoryEntryItemProps) {
	return (
		<AccordionItem key={entry.id} value={entry.id} className="border-border px-4">
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
						{!entry.success && entry.failureCode && (
							<Badge
								variant="outline"
								className="border-amber-300/40 bg-amber-300/5 font-mono text-[11px] text-amber-200"
							>
								{entry.failureCode}
							</Badge>
						)}
						{isActiveRelease && (
							<Badge
								variant="outline"
								className="border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
							>
								Active Release
							</Badge>
						)}
						{entry.durationMs && (
							<span className="text-xs text-muted-foreground flex items-center gap-1">
								<Clock className="size-3" />
								{(entry.durationMs / 1000 / 60).toFixed(1)}m
							</span>
						)}
					</div>
					{(entry.commitSha || entry.commitMessage || entry.branch) && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
							{entry.commitSha && (
								<div className="flex items-center gap-1.5 bg-background px-2 py-1 rounded border border-border/50">
									<GitCommit className="size-3" />
									<code className="font-mono">{entry.commitSha.substring(0, 7)}</code>
								</div>
							)}
							{entry.commitMessage && (
								<span className="max-w-64 truncate" title={entry.commitMessage}>
									{entry.commitMessage}
								</span>
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
									<div key={step.id} className="bg-background/50 p-2 rounded border border-border/50">
										<p className="font-semibold text-foreground mb-1">
											{step.label} ({step.status})
											{(step.startedAt || step.endedAt) && (
												<span className="text-muted-foreground font-normal ml-1">
													{" · "}
													{step.endedAt
														? new Date(step.endedAt).toLocaleTimeString(undefined, {
																hour: "2-digit",
																minute: "2-digit",
																second: "2-digit",
															})
														: new Date(step.startedAt!).toLocaleTimeString(undefined, {
																hour: "2-digit",
																minute: "2-digit",
																second: "2-digit",
															})}
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
					{!entry.success && (
						<div>
							<Button
								variant="outline"
								size="sm"
								className="border-border bg-transparent text-foreground hover:bg-secondary"
								onClick={() => onWhyDidItFail(entry)}
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
							{analysisText && (
								<Alert className="mt-3 border-border bg-card text-foreground">
									<AlertDescription className="text-sm whitespace-pre-wrap">{analysisText}</AlertDescription>
								</Alert>
							)}
						</div>
					)}
					{entry.success && hasUsableReleaseArtifact(entry.releaseArtifact) && onRollback && (
						<div className="flex justify-end">
							<Button
								variant="outline"
								size="sm"
								className="border-border bg-transparent text-foreground hover:bg-secondary"
								onClick={() => onRollback(entry)}
								disabled={rollbackingEntryId === entry.id || isActiveRelease}
							>
								{rollbackingEntryId === entry.id ? (
									<>
										<Loader2 className="size-4 animate-spin mr-2" />
										Rolling back...
									</>
								) : isActiveRelease ? (
									<>
										<RotateCcw className="size-4 mr-2" />
										Active Release
									</>
								) : (
									<>
										<RotateCcw className="size-4 mr-2" />
										Rollback to this release
									</>
								)}
							</Button>
						</div>
					)}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
}
