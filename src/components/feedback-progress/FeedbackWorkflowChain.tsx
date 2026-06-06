import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FEEDBACK_PROGRESS_NODES } from "@/components/feedback-progress/feedbackProgressConstants";

type FeedbackWorkflowChainProps = {
	activeNode: string;
	completedNodes: string[];
	failedNode: string | null;
};

export function FeedbackWorkflowChain({ activeNode, completedNodes, failedNode }: FeedbackWorkflowChainProps) {
	return (
		<div className="w-full lg:w-1/3 flex flex-col gap-4">
			<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workflow Chain</h3>
			<div className="flex flex-col gap-3">
				{FEEDBACK_PROGRESS_NODES.map((node) => {
					const isCompleted = completedNodes.includes(node.id);
					const isActive = activeNode === node.id && !isCompleted && !failedNode;
					const isFailed = failedNode === node.id;
					return (
						<Card
							key={node.id}
							className={`p-4 border transition-all duration-300 ${
								isActive
									? "border-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.1)] bg-card/80"
									: isCompleted
										? "border-emerald-500/20 bg-background/40"
										: isFailed
											? "border-destructive/50 bg-destructive/10"
											: "border-border/30 bg-background/20 opacity-60"
							}`}
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									{isCompleted ? (
										<CheckCircle2 className="size-5 text-emerald-500" />
									) : isActive ? (
										<Loader2 className="size-5 text-primary animate-spin" />
									) : isFailed ? (
										<XCircle className="size-5 text-destructive" />
									) : (
										<Circle className="size-5 text-muted-foreground/50" />
									)}
									<div className="flex flex-col">
										<span
											className={`font-medium text-sm ${isActive ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"}`}
										>
											{node.label}
										</span>
										<span className="text-xs text-muted-foreground/80">{node.desc}</span>
									</div>
								</div>
								{isCompleted && (
									<span className="text-[10px] uppercase font-bold text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded">
										Done
									</span>
								)}
							</div>
						</Card>
					);
				})}
			</div>
		</div>
	);
}
