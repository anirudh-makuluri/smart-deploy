"use client";

import * as React from "react";
import { Activity, Boxes, Bot, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type CapabilityCard = {
	icon: LucideIcon;
	title: string;
	description: string;
	prompt: string;
	accent: string;
};

const CAPABILITY_CARDS: CapabilityCard[] = [
	{
		icon: Boxes,
		title: "Deployments",
		description: "See everything you've shipped and where it's hosted.",
		prompt: "Show me my deployments",
		accent: "text-sky-500",
	},
	{
		icon: TriangleAlert,
		title: "Diagnose failures",
		description: "Understand what broke in your last deployment and why.",
		prompt: "Why did my last deployment fail?",
		accent: "text-amber-500",
	},
	{
		icon: Activity,
		title: "Runtime health",
		description: "Check live status, latency, and target health.",
		prompt: "Is my service healthy right now?",
		accent: "text-emerald-500",
	},
];

type DeploymentAgentEmptyStateProps = {
	welcome: string;
	disabled: boolean;
	onSelectPrompt: (prompt: string) => void;
};

export function DeploymentAgentEmptyState({
	welcome,
	disabled,
	onSelectPrompt,
}: DeploymentAgentEmptyStateProps) {
	return (
		<div className="flex flex-col items-center gap-5 px-2 py-6 text-center">
			<span className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-xs">
				<Bot className="size-6" />
			</span>
			<div className="space-y-1.5">
				<h2 className="text-base font-semibold text-foreground">How can I help you deploy?</h2>
				<p className="mx-auto max-w-88 text-xs leading-relaxed text-muted-foreground">{welcome}</p>
			</div>

			<div className="grid w-full gap-2">
				{CAPABILITY_CARDS.map((card) => {
					const Icon = card.icon;
					return (
						<button
							key={card.title}
							type="button"
							disabled={disabled}
							onClick={() => onSelectPrompt(card.prompt)}
							className={cn(
								"group flex items-start gap-3 rounded-lg border border-border bg-background/60 px-4 py-3 text-left transition-colors",
								"hover:border-primary/40 hover:bg-accent/50",
								"disabled:cursor-not-allowed disabled:opacity-60"
							)}
						>
							<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40">
								<Icon className={cn("size-4", card.accent)} />
							</span>
							<span className="space-y-0.5">
								<span className="block text-sm font-medium text-foreground">{card.title}</span>
								<span className="block text-xs leading-relaxed text-muted-foreground">
									{card.description}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
