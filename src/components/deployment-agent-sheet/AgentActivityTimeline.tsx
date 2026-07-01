"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import type { AgentActivityStep } from "@/components/deployment-agent-sheet/types";
import { cn } from "@/lib/utils";

type AgentActivityTimelineProps = {
	steps: AgentActivityStep[];
	pending: boolean;
};

function StepRow({ step }: { step: AgentActivityStep }) {
	const isActive = step.status === "active";
	return (
		<li className="flex items-start gap-2">
			<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
				{isActive ? (
					<Loader2 className="size-3.5 animate-spin text-primary" />
				) : (
					<Check className="size-3.5 text-emerald-500" />
				)}
			</span>
			<span
				className={cn(
					"leading-relaxed",
					isActive ? "text-foreground" : "text-muted-foreground"
				)}
			>
				{step.label}
			</span>
		</li>
	);
}

export function AgentActivityTimeline({ steps, pending }: AgentActivityTimelineProps) {
	const [expanded, setExpanded] = React.useState(false);

	if (steps.length === 0) {
		if (!pending) return null;
		return (
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<Loader2 className="size-3.5 animate-spin text-primary" />
				Thinking...
			</div>
		);
	}

	if (pending) {
		return (
			<ul className="space-y-1.5 text-xs">
				{steps.map((step) => (
					<StepRow key={step.id} step={step} />
				))}
			</ul>
		);
	}

	return (
		<div className="rounded-md border border-border/60 bg-muted/30">
			<button
				type="button"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
				aria-expanded={expanded}
			>
				<span className="inline-flex items-center gap-1.5">
					<Check className="size-3 text-emerald-500" />
					Worked through {steps.length} {steps.length === 1 ? "step" : "steps"}
				</span>
				<ChevronDown
					className={cn("size-3.5 transition-transform", expanded ? "rotate-180" : "rotate-0")}
				/>
			</button>
			{expanded ? (
				<ul className="space-y-1.5 border-t border-border/60 px-2.5 py-2 text-xs">
					{steps.map((step) => (
						<StepRow key={step.id} step={step} />
					))}
				</ul>
			) : null}
		</div>
	);
}
