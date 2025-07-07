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
		<Accordion className="bg-card p-2 rounded-md" type="single" collapsible value={openItem} onValueChange={setOpenItem}>
			{steps.map((step) => (
				<AccordionItem key={step.id} value={step.id}>
					<AccordionTrigger>
						<span className="flex items-center gap-2">
							{statusIcon[step.status]} {step.label}
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="bg-muted text-sm text-muted-foreground p-2 rounded-md space-y-1 max-h-60 overflow-y-auto">
							{step.logs.length === 0 ? (
								<p className="italic">No logs yet...</p>
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
