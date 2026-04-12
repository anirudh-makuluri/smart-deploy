import type { Metadata } from "next";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";

export const metadata: Metadata = {
	title: "Docs | Smart Deploy",
	description: "Product overview for Smart Deploy: audience, define-preview-deploy flow, blueprint view, and infrastructure files.",
};

const quickFacts = [
	{ value: "Define → Preview → Deploy", label: "core loop" },
	{ value: "Blueprint first", label: "before you ship" },
	{ value: "Files stay visible", label: "Docker, Compose, Nginx" },
];

const fitCards = [
	{
		title: "What Smart Deploy is",
		body: "A transparent deployment platform that helps you define infrastructure, preview the deploy path, and ship from one workspace.",
	},
	{
		title: "Who it is for",
		body: "Solo developers, indie hackers, and small teams who want a simpler deploy path without giving up visibility into how the app runs.",
	},
	{
		title: "What it is not",
		body: "It is not a fully managed black box, and it is not raw cloud setup with no guidance. It sits in the middle on purpose.",
	},
];

const workflowSteps = [
	{
		title: "1. Define it",
		body: "Bring your own Dockerfile, `docker-compose.yml`, and Nginx config, or let Smart Deploy generate a starting point from the repository.",
	},
	{
		title: "2. Preview it",
		body: "Open the blueprint view to see which services will run, how they connect, which ports are exposed, and how traffic will move through the deploy.",
	},
	{
		title: "3. Deploy it",
		body: "Once the blueprint and files make sense, start the deploy and follow logs, health, status, and preview output from the same workspace.",
	},
];

const blueprintPoints = [
	"The services Smart Deploy detected in the repository",
	"How containers are built and started",
	"Which ports and internal connections matter",
	"How Nginx routes external traffic to the right service",
	"What generated artifacts will be used during deploy",
];

const infraSections = [
	{
		title: "Dockerfile",
		body: "The Dockerfile describes how each image is built. Smart Deploy keeps that file visible so you can inspect the actual build steps instead of trusting a hidden build pipeline.",
	},
	{
		title: "docker-compose.yml",
		body: "The compose file defines how multiple services run together. Smart Deploy shows how those services map into the deployment plan so the relationship between app, worker, proxy, and supporting services stays readable.",
	},
	{
		title: "Nginx",
		body: "Nginx handles routing and proxy behavior. Smart Deploy makes the routing layer explicit so you can see how incoming traffic reaches your application before deploy starts.",
	},
];

const faqItems = [
	{
		question: "Do I have to write the infrastructure files myself?",
		answer: "No. You can provide your own files or use Smart Deploy to generate a starting point, then review and adjust the results before deploy.",
	},
	{
		question: "What is the blueprint view for?",
		answer: "It is the place where Smart Deploy explains the deployment path before anything runs. You can see the planned services, containers, routing, and file usage in one view.",
	},
	{
		question: "Why show the generated files at all?",
		answer: "Because the files are the deployment. Showing the Dockerfile, compose file, and Nginx config makes the deploy understandable and easier to debug.",
	},
	{
		question: "Is Smart Deploy only for experts?",
		answer: "No. The goal is to help less infrastructure-heavy teams ship while still learning the real concepts behind containers, routing, and multi-service deploys.",
	},
	{
		question: "What should I read next?",
		answer: "After this overview, the setup guides in `docs/` cover Supabase, AWS IAM, GCP, self-hosting, custom domains, and other environment-specific details.",
	},
];

export default async function DocsPage() {
	return (
		<PublicPageScroll>
			<PublicPageShell
				eyebrow="Smart Deploy Docs"
				badge="Product overview"
				title="Ship with clarity, not with a black box."
				description="This page is the on-site briefing: who Smart Deploy is for, how the define–preview–deploy loop works, what the blueprint is meant to answer, and how Docker, Compose, and Nginx stay in the story end to end."
				stats={quickFacts}
				showDocsButton={false}
				asideTitle="Start here"
				asideDescription="Read this overview once, then jump into the setup guides in the `docs/` folder when you are wiring Supabase, cloud accounts, or domains."
				asideLinks={[
					{ href: "/changelog", label: "Website and docs changelog" },
					{ href: "/", label: "Back to the landing page" },
				]}
			>
				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Product overview</p>
					<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">What Smart Deploy is for</h2>
					<div className="mt-6 grid gap-4 lg:grid-cols-3">
						{fitCards.map((card) => (
							<div key={card.title} className="rounded-[1.6rem] border border-border/70 bg-background/45 p-5">
								<h3 className="text-xl font-semibold tracking-tight text-foreground">{card.title}</h3>
								<p className="mt-3 text-sm leading-6 text-muted-foreground">{card.body}</p>
							</div>
						))}
					</div>
				</div>

				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Workflow</p>
					<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Define it. Preview it. Deploy it.</h2>
					<div className="mt-6 space-y-4">
						{workflowSteps.map((step) => (
							<div key={step.title} className="rounded-3xl border border-border/70 bg-background/40 p-5">
								<h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
							</div>
						))}
					</div>
				</div>

				<div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
					<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Blueprint view</p>
						<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">What the blueprint shows</h2>
						<p className="mt-4 text-sm leading-6 text-muted-foreground">
							The blueprint view exists so you can review the deployment path before the deploy starts. It turns the plan into something you can inspect instead of guess at.
						</p>
						<ul className="mt-6 space-y-3">
							{blueprintPoints.map((point) => (
								<li key={point} className="rounded-[1.35rem] border border-border/70 bg-background/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
									{point}
								</li>
							))}
						</ul>
					</div>

					<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Generated infrastructure</p>
						<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">How the infrastructure files fit together</h2>
						<div className="mt-6 space-y-4">
							{infraSections.map((section) => (
								<div key={section.title} className="rounded-[1.4rem] border border-border/70 bg-background/40 p-5">
									<h3 className="text-base font-semibold text-foreground">{section.title}</h3>
									<p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Preview before deploy</p>
					<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Why the preview step matters</h2>
					<div className="mt-6 grid gap-4 lg:grid-cols-3">
						{[
							"Catch mismatched ports, missing services, or routing assumptions before a deploy fails.",
							"See how generated files map onto the final deployment path instead of treating generation as a hidden step.",
							"Use the platform as a learning surface: you can ship now and still understand more about Docker, Compose, and reverse proxies over time.",
						].map((point) => (
							<div key={point} className="rounded-3xl border border-border/70 bg-background/40 p-5">
								<p className="text-sm leading-6 text-muted-foreground">{point}</p>
							</div>
						))}
					</div>
				</div>

				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">FAQ</p>
					<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Common questions</h2>
					<div className="mt-6 space-y-4">
						{faqItems.map((item) => (
							<div key={item.question} className="rounded-3xl border border-border/70 bg-background/40 p-5">
								<h3 className="text-base font-semibold text-foreground">{item.question}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</p>
							</div>
						))}
					</div>
				</div>
			</PublicPageShell>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
