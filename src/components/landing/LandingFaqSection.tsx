"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LANDING_FAQ } from "@/lib/landing/landingCopy";

export function LandingFaqSection() {
	return (
		<section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
			<div className="mb-10 text-center">
				<p className="bp-label inline-block">FAQ</p>
				<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					Questions, answered
				</h2>
			</div>
			<Accordion type="single" collapsible className="landing-panel rounded-lg border border-border px-5">
				{LANDING_FAQ.map((item) => (
					<AccordionItem key={item.question} value={item.question} className="border-border/50">
						<AccordionTrigger className="text-[15px] font-semibold text-foreground">
							{item.question}
						</AccordionTrigger>
						<AccordionContent className="text-sm leading-7 text-muted-foreground">
							{item.answer}
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</section>
	);
}
