"use client";

import { DeployStep } from "@/app/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useState } from "react";

const statusIcon = {
	pending: "🕒",
	in_progress: "⏳",
	success: "✅",
	error: "❌",
};

export default function DeploymentAccordion({ steps }: { steps: DeployStep[] }) {
	const [openItem, setOpenItem] = useState<string | undefined>(steps[0]?.id);

	return (
		<Accordion className="border border-border/60 bg-card/60 p-2 rounded-md" type="single" collapsible value={openItem} onValueChange={setOpenItem}>
			{steps.map((step) => (
				<AccordionItem key={step.id} value={step.id} className="border-border/40">
					<AccordionTrigger className="text-foreground hover:text-teal-400 hover:no-underline">
						<span className="flex items-center gap-2">
							{statusIcon[step.status]} {step.label}
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="bg-background/60 text-sm text-muted-foreground p-2 rounded-md space-y-1 max-h-60 overflow-y-auto border border-border/40">
							{step.logs.length === 0 ? (
								<p className="italic text-muted-foreground/70">No logs yet...</p>
							) : (
								step.logs.map((log, idx) => <p key={idx}>{log}</p>)
							)}
						</div>
					</AccordionContent>
				</AccordionItem>
			))}
		</Accordion>
	);
}

