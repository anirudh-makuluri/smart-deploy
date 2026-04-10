import type { Metadata } from "next";
import { CalendarDays, CheckCircle2, GitCommitHorizontal, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Big product updates and shipping milestones for SmartDeploy.",
};

const stats = [
	{ value: "2026", label: "active build cycle" },
	{ value: "4", label: "highlighted milestones" },
	{ value: "curated", label: "high-signal updates" },
];

const releases = [
	{
		date: "April 8, 2026",
		title: "Public site refresh",
		tag: "Brand & UX",
		summary:
			"We redesigned the public experience to explain product value faster, with cleaner hierarchy and sharper first-visit messaging.",
		points: [
			"Reworked page structure so value proposition, workflow, and proof points read as one narrative.",
			"Improved clarity for first-time builders coming from portfolio, referral, and social links.",
		],
		icon: Sparkles,
	},
	{
		date: "April 8, 2026",
		title: "Blueprint visibility in deployment workspace",
		tag: "Deploy UX",
		summary:
			"Deployment blueprint context now shows up directly in the deploy workspace so teams can validate decisions before rollout.",
		points: [
			"Made generated deployment guidance easier to inspect at decision time.",
			"Reduced friction between AI analysis output and actual shipping actions.",
		],
		icon: CheckCircle2,
	},
	{
		date: "April 7, 2026",
		title: "Delivery pipeline and preview tooling upgrade",
		tag: "Delivery",
		summary:
			"The core shipping flow gained better visibility with command generation improvements, preview screenshots, and more reliable deployment status handling.",
		points: [
			"Added richer step-level progress updates during repository scan and deployment prep.",
			"Introduced preview screenshot generation for faster pre-release validation.",
			"Hardened state handling for draft and in-progress deploy transitions.",
		],
		icon: Wrench,
	},
	{
		date: "April 3, 2026",
		title: "GraphQL and deployment model standardization",
		tag: "Architecture",
		summary:
			"We standardized deployment records and GraphQL types to reduce edge cases and make UI integration easier.",
		points: [
			"Unified type naming and flattened key deployment fields where UI access needed to be direct.",
			"Resolved deployment history and GraphQL query edge cases impacting reliability.",
		],
		icon: GitCommitHorizontal,
	},
];

export default async function ChangelogPage() {
	return (
		<>
			<PublicPageShell
				eyebrow="SmartDeploy Changelog"
				badge="Selected Milestones"
				title="Updates that made shipping faster."
				description="A curated stream of high-signal improvements across product UX, deploy workflow, and architecture."
				stats={stats}
				showMilestonesButton={false}
				asideTitle="Release history"
				asideDescription="Follow the milestones that improved onboarding clarity, ship speed, and runtime reliability."
				asideLinks={[
					{ href: "/docs", label: "Read the technical overview" },
					{ href: "/", label: "Back to SmartDeploy" },
				]}
			>
			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Release cadence</p>
						<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Recent shipping wins</h2>
					</div>
					<Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary">
						<CalendarDays className="size-3.5" />
						Updated through April 2026
					</Badge>
				</div>
				<div className="mt-8 space-y-5">
					{releases.map((release) => {
						const Icon = release.icon;

						return (
							<div key={`${release.date}-${release.title}`} className="rounded-[1.7rem] border border-border/70 bg-background/40 p-5 sm:p-6">
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div className="flex min-w-0 items-start gap-4">
										<div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
											<Icon className="size-5" />
										</div>
										<div className="min-w-0">
											<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{release.date}</p>
											<h3 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl wrap-break-word">{release.title}</h3>
										</div>
									</div>
									<Badge variant="outline" className="rounded-full border-border/80 bg-background/70 px-3 py-1 text-foreground">
										{release.tag}
									</Badge>
								</div>
								<p className="mt-5 text-sm leading-6 text-muted-foreground">{release.summary}</p>
								<ul className="mt-5 space-y-3">
									{release.points.map((point) => (
										<li key={point} className="rounded-[1.25rem] border border-border/70 bg-background/45 px-4 py-3 text-sm leading-6 text-muted-foreground">
											{point}
										</li>
									))}
								</ul>
							</div>
						);
					})}
				</div>
			</div>

			<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Release notes philosophy</p>
				<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">How we write updates</h2>
				<div className="mt-6 grid gap-4 lg:grid-cols-3">
					{[
						"Entries focus on user-visible progress over low-impact internal churn, so the changelog stays high signal.",
						"Updates span UX, deploy workflow, and architecture so the page reflects real product evolution, not isolated commits.",
						"Notes stay concise and chronological so builders can scan impact fast and get back to shipping.",
					].map((point) => (
						<div key={point} className="rounded-3xl border border-border/70 bg-background/40 p-5">
							<p className="text-sm leading-6 text-muted-foreground">{point}</p>
						</div>
					))}
				</div>
			</div>
		</PublicPageShell>
		<PublicPageFooter />
		</>
	);
}
