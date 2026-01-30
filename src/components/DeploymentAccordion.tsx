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
		<Accordion className="border border-[#1e3a5f]/60 bg-[#132f4c]/60 p-2 rounded-md" type="single" collapsible value={openItem} onValueChange={setOpenItem}>
			{steps.map((step) => (
				<AccordionItem key={step.id} value={step.id} className="border-[#1e3a5f]/40">
					<AccordionTrigger className="text-[#e2e8f0] hover:text-[#14b8a6] hover:no-underline">
						<span className="flex items-center gap-2">
							{statusIcon[step.status]} {step.label}
						</span>
					</AccordionTrigger>
					<AccordionContent>
						<div className="bg-[#0c1929]/60 text-sm text-[#94a3b8] p-2 rounded-md space-y-1 max-h-60 overflow-y-auto border border-[#1e3a5f]/40">
							{step.logs.length === 0 ? (
								<p className="italic text-[#64748b]">No logs yet...</p>
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
