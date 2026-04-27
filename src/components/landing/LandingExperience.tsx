"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import {
	Activity,
	ArrowRight,
	CheckCircle2,
	CloudCog,
	GitBranchPlus,
	Layers3,
	Search,
	ShieldCheck,
	Sparkles,
	TriangleAlert,
	type LucideIcon,
} from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { ScrollytellingSection } from "@/components/landing/ScrollytellingSection";
import { PublicBottomNav, type MobileNavLink } from "@/components/public/PublicBottomNav";
import { PublicPageFooterContent } from "@/components/public/PublicPageFooterContent";
import { Button } from "@/components/ui/button";
import type { DeployMetricsSummary } from "@/lib/metrics/deployMetricsCore";

type LandingExperienceProps = {
	isSignedIn: boolean;
	publicMetrics: DeployMetricsSummary | null;
};

type WhyCard = {
	title: string;
	detail: string;
	proof: string;
	icon: LucideIcon;
};

const whyCards: WhyCard[] = [
	{
		title: "Transparent by default",
		detail: "Every artifact and decision stays visible: scan output, blueprint stages, logs, and history.",
		proof: "No hidden pipeline steps or black-box deploy magic.",
		icon: ShieldCheck,
	},
	{
		title: "PaaS-level ease",
		detail: "Start from repo, scan, review, deploy in one guided workspace without tool-hopping.",
		proof: "Setup, scan, preview, logs, and controls in a single flow.",
		icon: CloudCog,
	},
	{
		title: "AI for real operations",
		detail: "AI does more than chat. It explains failures and helps regenerate safer deploy artifacts.",
		proof: "Root-cause analysis + Improve Scan Results chain.",
		icon: Sparkles,
	},
];

const landingMobileNavLinks: MobileNavLink[] = [
	{ href: "#flow", label: "Flow" },
	{ href: "#why-smartdeploy", label: "Why" },
	{ href: "#cloud", label: "Cloud" },
	{ href: "#stats", label: "Stats" },
];

const supportedJsFrameworks = [
	"React",
	"Next.js",
	"Vue",
	"Nuxt",
	"Angular",
	"Svelte",
	"SvelteKit",
	"Remix",
	"Astro",
	"Gatsby",
	"Express",
	"NestJS",
	"Fastify",
	"Hono",
	"Koa",
];

const supportedPythonFrameworks = [
	"Django",
	"Flask",
	"FastAPI",
	"Starlette",
	"Sanic",
	"Falcon",
	"Tornado",
	"Pyramid",
	"Bottle",
	"CherryPy",
	"Streamlit",
	"Dash",
	"Gradio",
];

const sectionAnchorClass = "scroll-mt-20 sm:scroll-mt-24";

function formatDurationMs(ms: number | null): string {
	if (ms === null) return "--";
	if (ms < 1000) return `${ms} ms`;
	const s = ms / 1000;
	if (s < 60) return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
	const m = Math.floor(s / 60);
	const sec = Math.round(s % 60);
	return `${m}m ${sec}s`;
}

function SectionIntro({
	eyebrow,
	title,
	description,
}: {
	eyebrow: string;
	title: string;
	description: string;
}) {
	return (
		<div className="mx-auto max-w-3xl text-center">
			<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">{eyebrow}</p>
			<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">{title}</h2>
			<p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
		</div>
	);
}

function WhySmartDeploy() {
	const prefersReducedMotion = useReducedMotion();
	return (
		<div className="grid gap-4 md:grid-cols-3">
			{whyCards.map((card, index) => {
				const Icon = card.icon;
				return (
					<motion.div
						key={card.title}
						initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
						whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
						viewport={{ once: true, amount: 0.25 }}
						transition={prefersReducedMotion ? undefined : { duration: 0.45, delay: index * 0.08, ease: "easeOut" }}
						className="landing-panel landing-shell relative overflow-hidden p-6"
					>
						<div
							className="pointer-events-none absolute inset-0 opacity-25"
							style={{
								background:
									"radial-gradient(circle at top right, color-mix(in srgb, var(--primary) 16%, transparent), transparent 48%)",
							}}
							aria-hidden
						/>
						<div className="relative z-10">
							<div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
								<Icon className="size-5" />
							</div>
							<h3 className="mt-4 text-lg font-semibold text-foreground">{card.title}</h3>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">{card.detail}</p>
							<p className="mt-4 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-xs text-foreground">{card.proof}</p>
						</div>
					</motion.div>
				);
			})}
		</div>
	);
}

function CloudProviders() {
	const providers = [
		{ name: "AWS", logo: "/logos/aws.svg" },
		{ name: "GCP", logo: "/logos/google-cloud.svg" },
	];

	return (
		<ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
			{providers.map((provider) => (
				<li key={provider.name} className="flex items-center gap-2.5 text-foreground">
					<Image src={provider.logo} alt={`${provider.name} logo`} width={28} height={28} className="size-7" />
					<span className="text-base font-semibold">{provider.name}</span>
				</li>
			))}
		</ul>
	);
}

function SupportedFrameworks() {
	const groups = [
		{
			id: "js",
			title: "JavaScript / TypeScript",
			frameworks: supportedJsFrameworks,
		},
		{
			id: "python",
			title: "Python",
			frameworks: supportedPythonFrameworks,
		},
	];

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			{groups.map((group) => (
				<div key={group.id} className="landing-panel landing-shell p-5 sm:p-6">
					<div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
						<p className="text-sm font-semibold text-foreground">{group.title}</p>
						<span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
							Supported
						</span>
					</div>
					<div className="mt-4 flex flex-wrap gap-2">
						{group.frameworks.map((framework) => (
							<span
								key={framework}
								className="rounded-md border border-border/60 bg-background/75 px-2.5 py-1 text-xs text-foreground"
							>
								{framework}
							</span>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function StatsBoard({ metrics }: { metrics: DeployMetricsSummary | null }) {
	const successRate =
		metrics?.successRatePercent === null || metrics?.successRatePercent === undefined
			? "--"
			: `${metrics.successRatePercent}%`;
	const totalCount = metrics?.totalCount ?? 0;
	const median = formatDurationMs(metrics?.medianDurationMs ?? null);
	const p95 = formatDurationMs(metrics?.p95DurationMs ?? null);
	const updatedAt = metrics
		? `${new Intl.DateTimeFormat("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: "UTC",
		  }).format(new Date(metrics.computedAt))} UTC`
		: "Telemetry appears after the first deployment";

	return (
		<div className="landing-panel landing-shell relative overflow-hidden p-5 sm:p-6">
			<div className="landing-grid-overlay absolute inset-0 opacity-20" aria-hidden />
			<div className="relative z-10">
				<p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Public deployment stats</p>
				<p className="mt-1 text-xs text-muted-foreground">{updatedAt}</p>
				<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div className="rounded-xl border border-border/60 bg-background/70 p-3">
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Deployments</p>
						<p className="mt-2 font-mono text-lg font-semibold text-foreground">{totalCount}</p>
					</div>
					<div className="rounded-xl border border-border/60 bg-background/70 p-3">
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Success</p>
						<p className="mt-2 font-mono text-lg font-semibold text-foreground">{successRate}</p>
					</div>
					<div className="rounded-xl border border-border/60 bg-background/70 p-3">
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Median</p>
						<p className="mt-2 font-mono text-lg font-semibold text-foreground">{median}</p>
					</div>
					<div className="rounded-xl border border-border/60 bg-background/70 p-3">
						<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">P95</p>
						<p className="mt-2 font-mono text-lg font-semibold text-foreground">{p95}</p>
					</div>
				</div>
			</div>
		</div>
	);
}

function FinalCTA({ primaryHref, primaryCopy }: { primaryHref: string; primaryCopy: string }) {
	return (
		<div className="landing-panel landing-shell relative overflow-hidden p-7 text-center sm:p-9">
			<div className="landing-grid-overlay absolute inset-0 opacity-25" aria-hidden />
			<div className="relative z-10 mx-auto max-w-3xl">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Ready to deploy with visibility?</p>
				<h3 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Move fast without losing control</h3>
				<p className="mt-4 text-base leading-7 text-muted-foreground">
					Smart Deploy gives you fast shipping, inspectable artifacts, and AI-guided recovery in one workflow.
				</p>
				<div className="mt-7 flex flex-wrap items-center justify-center gap-3">
					<Button asChild size="lg" className="gap-2 shadow-[0_18px_40px_-24px_rgba(37,244,106,0.45)]">
						<Link href={primaryHref}>
							{primaryCopy}
							<ArrowRight className="size-4" />
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}

export function LandingExperience({ isSignedIn, publicMetrics }: LandingExperienceProps) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Open Smart Deploy";

	React.useEffect(() => {
		const hash = window.location.hash;
		if (!hash) return;
		const targetId = decodeURIComponent(hash.slice(1));
		let canceled = false;
		const run = () => {
			if (canceled) return;
			const el = document.getElementById(targetId);
			if (!el) return;
			el.scrollIntoView({ behavior: "auto", block: "start" });
		};
		const rafId = requestAnimationFrame(() => requestAnimationFrame(run));
		return () => {
			canceled = true;
			cancelAnimationFrame(rafId);
		};
	}, []);

	return (
		<div className="landing-bg h-svh overflow-x-hidden overflow-y-auto stealth-scrollbar pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] text-foreground md:pb-0">
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
					<div className="min-w-0 shrink">
						<SmartDeployLogo href="/" />
					</div>
					<nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:gap-8 md:flex" aria-label="Primary">
						<a href="#flow" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Flow</a>
						<a href="#why-smartdeploy" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Why</a>
						<a href="#cloud" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Cloud</a>
						<a href="#stats" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Stats</a>
					</nav>
					<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
						<Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
							<Link href="/docs">Docs</Link>
						</Button>
						<Button asChild size="sm" className="shadow-[0_18px_40px_-20px_rgba(37,244,106,0.45)] sm:h-9 sm:px-4 sm:text-sm">
							<Link href={primaryHref}>
								{isSignedIn ? (
									<>
										<span className="sm:hidden">Dashboard</span>
										<span className="hidden sm:inline">{primaryCopy}</span>
									</>
								) : (
									<>
										<span className="sm:hidden">Get started</span>
										<span className="hidden sm:inline">{primaryCopy}</span>
									</>
								)}
							</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				<section className="landing-hero-bg relative flex min-h-[calc(100svh-4.5rem)] items-center overflow-hidden px-6 py-12 sm:min-h-[calc(100svh-4.5rem)] lg:px-10 lg:py-16">
					<div className="landing-hero-wave pointer-events-none absolute inset-x-0 top-0 h-112 opacity-55" aria-hidden />
					<div className="landing-grid-overlay pointer-events-none absolute inset-0 opacity-30" aria-hidden />
					<div className="relative z-10 mx-auto w-full max-w-6xl text-center">
						<p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Deploy workspace, rebuilt for clarity</p>
						<h1 className="mx-auto mt-6 max-w-4xl text-4xl font-semibold leading-[1.03] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
							Deploy your app with full transparency and the same ease you expect.
						</h1>
						<p className="mx-auto mt-8 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
							Pick a repo, scan, preview, deploy, recover with AI if needed, and ship with confidence.
						</p>
						<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
							<Button asChild size="lg" className="gap-2 shadow-[0_18px_40px_-24px_rgba(37,244,106,0.45)]">
								<Link href={primaryHref}>
									{primaryCopy}
									<ArrowRight className="size-4" />
								</Link>
							</Button>
							<Button asChild size="lg" variant="outline">
								<a href="#flow">Watch full deploy flow</a>
							</Button>
						</div>
					</div>
				</section>

				<ScrollytellingSection />

				<section id="why-smartdeploy" className={`border-t border-border/60 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Why SmartDeploy"
							title="Not another deploy UI. A transparent deploy system."
							description="It feels as easy as modern PaaS platforms, but keeps decisions visible so teams can trust what ships."
						/>
						<div className="mt-12">
							<WhySmartDeploy />
						</div>
					</div>
				</section>

				<section id="cloud" className={`border-t border-border/60 bg-muted/20 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Cloud Targets"
							title="Deploy where your team already runs"
							description="Deploy on AWS and GCP from one clean workflow."
						/>
						<div className="mt-12">
							<CloudProviders />
						</div>
					</div>
				</section>

				<section id="stats" className={`border-t border-border/60 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Public Metrics"
							title="Track deployment performance transparently"
							description="Deployment count, success rate, and latency distributions are surfaced directly on the landing page."
						/>
						<div className="mt-10">
							<StatsBoard metrics={publicMetrics} />
						</div>
					</div>
				</section>

				<section className="border-t border-border/60 bg-muted/20 px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<FinalCTA primaryHref={primaryHref} primaryCopy={primaryCopy} />
					</div>
				</section>
			</main>

			<PublicPageFooterContent primaryHref={primaryHref} />
			<PublicBottomNav links={landingMobileNavLinks} />
		</div>
	);
}

