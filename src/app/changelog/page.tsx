import type { Metadata } from "next";
import { Activity, CheckCircle2, GitCommitHorizontal, ShieldCheck, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Recent product updates and shipping milestones for SmartDeploy.",
};

const stats = [
	{ value: "2026", label: "active build cycle" },
	{ value: "5", label: "recent milestones" },
	{ value: "April 12", label: "latest shipped update" },
];

const releases = [
	{
		date: "April 12, 2026",
		title: "System health panel and authenticated service checks",
		tag: "Operations",
		summary:
			"SmartDeploy now surfaces live service health in the header so teams can quickly confirm that deploy-critical backends are reachable before running a deploy or analysis flow.",
		points: [
			"Added an authenticated system health API that checks both the WebSocket worker and the SD Artifacts server.",
			"Introduced separate liveness and authenticated health endpoints with `/health` for infra and `/healthz` for app-aware checks.",
			"Turned the header status badge into a clickable health panel showing per-service online state.",
		],
		icon: Activity,
	},
	{
		date: "April 12, 2026",
		title: "WebSocket auth, origin controls, and Render-friendly worker runtime",
		tag: "Runtime",
		summary:
			"The WebSocket worker was hardened for production use and simplified for Render deployment, reducing startup issues and tightening access control.",
		points: [
			"Added short-lived signed WebSocket auth tokens so only authenticated app users can connect to the deploy worker.",
			"Added `WS_ALLOWED_ORIGINS` support so worker browser access can be locked to trusted frontend origins.",
			"Moved the worker away from `ts-node` in production to a compiled runtime to avoid Render startup memory issues.",
		],
		icon: Wrench,
	},
	{
		date: "April 12, 2026",
		title: "Access control moved to approved-user allowlist",
		tag: "Security",
		summary:
			"Authentication is now backed by a Supabase allowlist instead of a hardcoded email rule, making access control manageable from the database.",
		points: [
			"Added an `approved_users` table and sign-in lookup for explicit user approval.",
			"Kept the `waiting_list` flow for unapproved sign-in attempts so access requests are still captured.",
			"Updated setup docs so self-hosting teams can manage access with SQL instead of code changes.",
		],
		icon: ShieldCheck,
	},
	{
		date: "April 12, 2026",
		title: "Worker health checks and dashboard visibility",
		tag: "Deploy UX",
		summary:
			"Operational visibility improved across the product, from the WebSocket worker itself to the frontend surfaces that rely on it.",
		points: [
			"Added worker health endpoints and dashboard awareness for deploy-worker availability.",
			"Aligned health URL handling across `wss://host` and `wss://host/ws` forms.",
			"Improved same-origin worker URL behavior for direct EC2 and split-host deployments.",
		],
		icon: CheckCircle2,
	},
	{
		date: "April 12, 2026",
		title: "Pipeline and self-hosting path tightened around scan results",
		tag: "Architecture",
		summary:
			"The deploy path now leans more cleanly on `scan_results` as the deployment source of truth, reducing accidental inference during deploy execution.",
		points: [
			"Removed hydration-driven deployment intent fallback in favor of scan-result-driven behavior.",
			"Tightened multi-service deploy expectations around Docker Compose, Dockerfiles, and Nginx artifacts.",
			"Improved confidence in SmartDeploy deploying repos that already provide correct generated artifacts.",
		],
		icon: GitCommitHorizontal,
	},
];

export default async function ChangelogPage() {
	return (
		<>
			<PublicPageShell
				eyebrow="SmartDeploy Changelog"
				badge="Latest Releases"
				title="Updates that improved reliability and control."
				description="Recent SmartDeploy work focused on deploy-runtime health, stronger auth, cleaner self-hosting, and safer production operations."
				stats={stats}
				showMilestonesButton={false}
				asideTitle="Release history"
				asideDescription="Follow the most recent milestones across operations, security, runtime stability, and deploy architecture."
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
							<Activity className="size-3.5" />
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
							"Entries focus on user-visible progress and operational reliability, not low-signal internal churn.",
							"Updates span auth, runtime, deploy workflow, and architecture so the changelog reflects the real product shape.",
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
