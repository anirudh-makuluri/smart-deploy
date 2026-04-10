import type { Metadata } from "next";
import { ArrowRight, Bot, Boxes, Check, Cloud, GitBranch, Minus, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";

export const metadata: Metadata = {
	title: "Docs | Smart Deploy",
	description: "Builder docs for SmartDeploy: how it works, how it ships, and why we built it this way.",
};

const quickFacts = [
	{ value: "2", label: "core layers" },
	{ value: "AWS + GCP", label: "cloud providers" },
	{ value: "repo-first", label: "ship model" },
];

const capabilityCards = [
	{
		title: "Repo onboarding + preflight",
		description:
			"Connect a repo and SmartDeploy maps services, runtimes, and dependencies, then creates a deployment blueprint before anything runs.",
		icon: GitBranch,
	},
	{
		title: "One deploy workspace",
		description:
			"Config, logs, deployment history, and service controls are in one place so you can ship fast without tab hopping.",
		icon: Boxes,
	},
	{
		title: "Cloud-native execution",
		description:
			"Deploy to AWS EC2 or Google Cloud Run, with deeper AWS paths through ALB, ECR, CodeBuild, IAM, and SSM.",
		icon: Cloud,
	},
];

const architectureSections = [
	{
		title: "App + API layer",
		body:
			"Next.js powers the public site, auth flow, dashboard UX, and API surface (GraphQL + REST) for deployment workflows.",
	},
	{
		title: "Deployment worker",
		body:
			"A dedicated WebSocket worker handles long-running jobs: cloning repos, building containers, running cloud ops, and streaming progress live.",
	},
	{
		title: "State and persistence",
		body:
			"Supabase stores repo metadata and deployment records so teams can recover history and keep operating from a reliable release surface.",
	},
];

const flowSteps = [
	"Connect GitHub and import your repository.",
	"Run a scan to detect services, runtime requirements, and deployment shape.",
	"Generate a blueprint with recommended defaults and safety checks.",
	"Pick your cloud target, set env config, and start rollout.",
	"Watch build logs, rollout events, and preview output in real time.",
];

const tradeoffs = [
	{
		label: "Why a separate worker",
		text: "Deployments are long-running, so we isolate them from the web app to keep the UI fast while still streaming live progress.",
	},
	{
		label: "Why AWS + GCP",
		text: "You get cross-cloud flexibility without hiding provider-specific controls that matter in real deployments.",
	},
	{
		label: "Why AI is scoped",
		text: "AI helps with analysis and command generation, but deployment control stays in explicit code paths.",
	},
];

const comparisonRows = [
	{
		feature: "Repository-aware preflight before deploy",
		smartDeploy: "Built-in",
		vercel: "Limited",
		render: "Limited",
		ciCd: "Scripted",
	},
	{
		feature: "Deploy workspace with logs plus preview plus state",
		smartDeploy: "Unified",
		vercel: "Partial",
		render: "Partial",
		ciCd: "Split across tools",
	},
	{
		feature: "Blueprint-driven deploy decisions",
		smartDeploy: "Built-in",
		vercel: "No",
		render: "No",
		ciCd: "Manual",
	},
	{
		feature: "AWS and GCP support",
		smartDeploy: "Yes",
		vercel: "No",
		render: "Partial",
		ciCd: "Depends on setup",
	},
	{
		feature: "Live release validation during rollout",
		smartDeploy: "Yes",
		vercel: "Partial",
		render: "Partial",
		ciCd: "Custom",
	},
];

function ComparisonCell({ value }: { value: string }) {
	if (value === "Yes") {
		return (
			<span className="inline-flex items-center gap-1.5 text-foreground">
				<Check className="size-4 text-primary" />
				Yes
			</span>
		);
	}

	if (value === "No") {
		return (
			<span className="inline-flex items-center gap-1.5 text-muted-foreground">
				<Minus className="size-4" />
				No
			</span>
		);
	}

	return <span className="text-muted-foreground">{value}</span>;
}

export default async function DocsPage() {
	return (
		<>
			<PublicPageShell
			eyebrow="SmartDeploy Docs"
			badge="Technical Overview"
			title="From repo to prod in one flow."
			description="This doc breaks down how SmartDeploy is built, how deployments run, and the tradeoffs behind the current architecture."
			stats={quickFacts}
			showDocsButton={false}
			asideTitle="Documentation at a glance"
			asideDescription="Start with the product snapshot, then jump into architecture, deploy flow, and key engineering decisions."
			asideLinks={[
				{ href: "/changelog", label: "Browse milestone history" },
				{ href: "/", label: "Return to the landing page" },
			]}
		>
			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">System snapshot</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">What you get on day one</h2>
					</div>
					<Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary">
						<Bot className="size-3.5" />
						AI-assisted deploy workflow
					</Badge>
				</div>
				<div className="mt-6 grid gap-4 lg:grid-cols-3">
					{capabilityCards.map((card) => {
						const Icon = card.icon;

						return (
							<div key={card.title} className="rounded-[1.6rem] border border-border/70 bg-background/45 p-5">
								<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
									<Icon className="size-5" />
								</div>
								<h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">{card.title}</h3>
								<p className="mt-3 text-sm leading-6 text-muted-foreground">{card.description}</p>
							</div>
						);
					})}
				</div>
			</div>

			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Architecture</p>
				<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">How it is wired</h2>
				<div className="mt-6 space-y-4">
					{architectureSections.map((section) => (
						<div key={section.title} className="rounded-3xl border border-border/70 bg-background/40 p-5">
							<h3 className="text-lg font-semibold text-foreground">{section.title}</h3>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">{section.body}</p>
						</div>
					))}
				</div>
			</div>

			<div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<div className="flex items-center gap-3 text-primary">
						<div className="rounded-2xl bg-primary/10 p-3">
							<Workflow className="size-5" />
						</div>
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Deployment flow</p>
					</div>
					<ol className="mt-6 space-y-3">
						{flowSteps.map((step, index) => (
							<li key={step} className="flex gap-4 rounded-[1.35rem] border border-border/70 bg-background/40 p-4">
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
									{index + 1}
								</span>
								<p className="text-sm leading-6 text-muted-foreground">{step}</p>
							</li>
						))}
					</ol>
				</div>

				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<div className="flex items-center gap-3 text-primary">
						<div className="rounded-2xl bg-primary/10 p-3">
							<ShieldCheck className="size-5" />
						</div>
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Engineering decisions</p>
					</div>
					<div className="mt-6 space-y-4">
						{tradeoffs.map((item) => (
							<div key={item.label} className="rounded-[1.4rem] border border-border/70 bg-background/40 p-5">
								<h3 className="text-base font-semibold text-foreground">{item.label}</h3>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
							</div>
						))}
					</div>
					<div className="mt-6 rounded-[1.6rem] border border-primary/20 bg-primary/8 p-5">
						<p className="text-sm font-semibold text-foreground">Setup guides are in the repo.</p>
						<p className="mt-2 text-sm leading-6 text-muted-foreground">
							You will find deeper docs for Supabase, self-hosting, AWS IAM, GCP setup, SSL, and custom domains.
						</p>
					</div>
				</div>
			</div>

			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Positioning</p>
				<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">How SmartDeploy compares</h2>
				<p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
					SmartDeploy is not a universal replacement for every platform. It is stronger for multi-service, repo-first workflows where
					teams want deploy decisions, rollout state, and validation in one surface.
				</p>

				<div className="mt-6 space-y-3 md:hidden">
					{comparisonRows.map((row) => (
						<div key={row.feature} className="rounded-2xl border border-border/70 bg-background/45 p-4">
							<p className="text-sm font-semibold text-foreground">{row.feature}</p>
							<div className="mt-3 space-y-2 text-sm">
								<div className="flex items-center justify-between gap-3">
									<span className="text-muted-foreground">SmartDeploy</span>
									<ComparisonCell value={row.smartDeploy} />
								</div>
								<div className="flex items-center justify-between gap-3">
									<span className="text-muted-foreground">Vercel</span>
									<ComparisonCell value={row.vercel} />
								</div>
								<div className="flex items-center justify-between gap-3">
									<span className="text-muted-foreground">Render</span>
									<ComparisonCell value={row.render} />
								</div>
								<div className="flex items-center justify-between gap-3">
									<span className="text-muted-foreground">DIY CI/CD Stack</span>
									<ComparisonCell value={row.ciCd} />
								</div>
							</div>
						</div>
					))}
				</div>

				<div className="mt-6 hidden overflow-x-auto rounded-3xl border border-border/70 bg-background/40 md:block">
					<table className="min-w-245 w-full text-sm">
						<thead>
							<tr className="border-b border-border/70 bg-background/60 text-left">
								<th className="px-4 py-3 font-semibold text-foreground">Capability</th>
								<th className="px-4 py-3 font-semibold text-foreground">SmartDeploy</th>
								<th className="px-4 py-3 font-semibold text-foreground">Vercel</th>
								<th className="px-4 py-3 font-semibold text-foreground">Render</th>
								<th className="px-4 py-3 font-semibold text-foreground">DIY CI/CD Stack</th>
							</tr>
						</thead>
						<tbody>
							{comparisonRows.map((row) => (
								<tr key={row.feature} className="border-b border-border/60 last:border-b-0">
									<td className="px-4 py-3 font-medium text-foreground">{row.feature}</td>
									<td className="px-4 py-3"><ComparisonCell value={row.smartDeploy} /></td>
									<td className="px-4 py-3"><ComparisonCell value={row.vercel} /></td>
									<td className="px-4 py-3"><ComparisonCell value={row.render} /></td>
									<td className="px-4 py-3"><ComparisonCell value={row.ciCd} /></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="mt-3 text-xs leading-5 text-muted-foreground">
					Capabilities evolve over time. This comparison reflects current product positioning and typical usage patterns.
				</p>
			</div>

			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Platform qualities</p>
				<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Why it feels product-grade</h2>
				<div className="mt-6 grid gap-4 lg:grid-cols-3">
					{[
						"One product surface: public site, authenticated dashboard, APIs, worker runtime, and deploy UX all move together.",
						"Real cloud depth: EC2, ALB, ECR, CodeBuild, SSM, Cloud Run, Cloud Build, and runtime logs are part of the actual implementation.",
						"Feedback-first UX: teams see live status and context during rollout instead of guessing what happened in another console.",
					].map((point) => (
						<div key={point} className="rounded-3xl border border-border/70 bg-background/40 p-5">
							<div className="flex items-center gap-2 text-primary">
								<ArrowRight className="size-4" />
								<p className="text-sm font-semibold text-foreground">Key characteristic</p>
							</div>
							<p className="mt-3 text-sm leading-6 text-muted-foreground">{point}</p>
						</div>
					))}
				</div>
			</div>
		</PublicPageShell>
		<PublicPageFooter />
		</>
	);
}
