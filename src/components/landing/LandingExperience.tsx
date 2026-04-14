"use client";

import React from "react";
import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
	ArrowRight,
	CheckCircle2,
	FileCode2,
	ImageOff,
	Layers3,
	ServerCog,
	type LucideIcon,
} from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { PublicBottomNav, type MobileNavLink } from "@/components/public/PublicBottomNav";
import { PublicPageFooterContent } from "@/components/public/PublicPageFooterContent";
import { Button } from "@/components/ui/button";
import { LandingMetricsStrip } from "@/components/landing/LandingMetricsStrip";
import type { DeployMetricsSummary } from "@/lib/metrics/deployMetricsCore";

type LandingExperienceProps = {
	isSignedIn: boolean;
	/** All-time aggregate metrics; shown when present and there is at least one deployment */
	publicMetrics: DeployMetricsSummary | null;
};

type StoryCard = {
	eyebrow: string;
	title: string;
	description: string;
};

type WorkflowStep = {
	id: string;
	title: string;
	description: string;
	icon: LucideIcon;
};

type ComparisonRow = {
	platform: string;
	ease: string;
	visibility: string;
	highlight?: boolean;
};

const storyCards: StoryCard[] = [
	{
		eyebrow: "PaaS",
		title: "Easy to ship, hard to inspect.",
		description:
			"Platforms like Vercel, Netlify, Render, and Railway get you moving quickly, but they rarely show the full deploy path or the exact infrastructure files behind it.",
	},
	{
		eyebrow: "Cloud",
		title: "Full control, full surface area.",
		description:
			"Raw AWS and GCP give you the pieces, but you are the one stitching together containers, networking, health checks, logs, and deploy orchestration.",
	},
	{
		eyebrow: "Smart Deploy",
		title: "A middle path built for solo developers.",
		description:
			"Bring your own Docker, Compose, and Nginx or generate a starting point, open the blueprint once it makes sense, then ship with the same files you already inspected.",
	},
];

const workflowSteps: WorkflowStep[] = [
	{
		id: "01",
		title: "Write it or generate it",
		description:
			"Bring your own Dockerfile, docker-compose.yml, and Nginx config, or let Smart Deploy generate a starting point for you.",
		icon: FileCode2,
	},
	{
		id: "02",
		title: "Inspect the blueprint",
		description:
			"Open that plan in one place: services, ports, containers, and how traffic moves, before the deploy starts.",
		icon: Layers3,
	},
	{
		id: "03",
		title: "Review the actual files",
		description:
			"Check the generated or existing Docker, Compose, and Nginx artifacts and see how each one is used in the deploy.",
		icon: ServerCog,
	},
	{
		id: "04",
		title: "Deploy with confidence",
		description:
			"Start the deploy once the plan makes sense, then follow logs, status, health, and preview output from the same workspace.",
		icon: CheckCircle2,
	},
];

const comparisonRows: ComparisonRow[] = [
	{ platform: "Vercel / Netlify", ease: "High", visibility: "Low" },
	{ platform: "Render / Railway", ease: "Medium", visibility: "Low-Medium" },
	{ platform: "AWS / GCP", ease: "Low", visibility: "High" },
	{ platform: "Dokku / Coolify", ease: "Medium", visibility: "High" },
	{ platform: "Smart Deploy", ease: "High", visibility: "High", highlight: true },
];

/** Offset for in-page anchors so sticky header does not cover section titles */
const sectionAnchorClass = "scroll-mt-20 sm:scroll-mt-24";

const landingMobileNavLinks: MobileNavLink[] = [
	{ href: "#start-your-way", label: "Your way" },
	{ href: "#problem-solution", label: "Problem and solution" },
	{ href: "#comparison", label: "Comparison" },
	{ href: "#workflow", label: "How it works" },
];

const containerVariants: Variants = {
	hidden: {},
	show: {
		transition: {
			staggerChildren: 0.12,
			delayChildren: 0.06,
		},
	},
};

const heroItemVariants: Variants = {
	hidden: { opacity: 0, y: 24 },
	show: {
		opacity: 1,
		y: 0,
		transition: { duration: 0.7, ease: "easeOut" as const },
	},
};

const drawLineVariants: Variants = {
	hidden: { scaleX: 0, opacity: 0.35 },
	show: {
		scaleX: 1,
		opacity: 1,
		transition: { duration: 0.9, ease: "easeOut" as const },
	},
};

function MotionDiv({
	children,
	className,
	delay = 0,
	y = 20,
}: {
	children: React.ReactNode;
	className?: string;
	delay?: number;
	y?: number;
}) {
	const prefersReducedMotion = useReducedMotion();

	if (prefersReducedMotion) {
		return <div className={className}>{children}</div>;
	}

	return (
		<motion.div
			className={className}
			initial={{ opacity: 0, y }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.2 }}
			transition={{ duration: 0.55, delay, ease: "easeOut" }}
		>
			{children}
		</motion.div>
	);
}

function SectionIntro({
	eyebrow,
	title,
	description,
	align = "center",
}: {
	eyebrow: string;
	title: string;
	description: string;
	align?: "left" | "center";
}) {
	return (
		<div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
			<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">{eyebrow}</p>
			<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">{title}</h2>
			<p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">{description}</p>
		</div>
	);
}

function ScreenshotImage({ src, alt }: { src: string; alt: string }) {
	const [failed, setFailed] = useState(false);

	if (failed) {
		return (
			<div className="flex min-h-70 flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed border-border/70 bg-muted/30 p-8 sm:min-h-90">
				<div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
					<ImageOff className="size-6" />
				</div>
				<div className="text-center">
					<p className="text-sm font-medium text-muted-foreground">Screenshot unavailable</p>
					<p className="mt-1 text-xs text-muted-foreground/70">Add a current product capture to replace this fallback</p>
				</div>
			</div>
		);
	}

	return (
		<div className="relative overflow-hidden rounded-[20px] border border-border/40">
			<Image
				src={src}
				alt={alt}
				width={1600}
				height={1000}
				onError={() => setFailed(true)}
				className="w-full object-cover"
			/>
		</div>
	);
}

function HeroPreview() {
	const prefersReducedMotion = useReducedMotion();

	return (
		<motion.div
			className="relative"
			initial={prefersReducedMotion ? false : { opacity: 0, y: 18, scale: 0.97, rotateX: 8 }}
			animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1, rotateX: 0 }}
			transition={prefersReducedMotion ? undefined : { duration: 0.85, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
		>
			<motion.div
				className="landing-halo landing-halo-float absolute -right-8 -top-10 h-40 w-40 rounded-full opacity-80 blur-3xl"
				aria-hidden
				animate={prefersReducedMotion ? undefined : { x: [0, 10, -6, 0], y: [0, 8, -4, 0], scale: [1, 1.08, 0.98, 1] }}
				transition={prefersReducedMotion ? undefined : { duration: 12, repeat: Infinity, ease: "easeInOut" }}
			/>
			<div className="landing-panel landing-shell relative overflow-hidden p-3 sm:p-4">
				<div className="landing-grid-overlay absolute inset-0 opacity-30" aria-hidden />
				<div className="relative z-10 rounded-[26px] border border-border/70 bg-background/70 p-4 sm:p-5">
					<div className="flex items-center justify-between gap-4 border-b border-border/70 pb-4">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Blueprint preview</p>
							<h3 className="mt-2 text-xl font-semibold text-foreground">Define it. Preview it. Deploy it.</h3>
						</div>
						<div className="hidden rounded-2xl border border-border/70 bg-card/80 px-3 py-2 text-right sm:block">
							<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Visibility</p>
							<p className="mt-1 text-sm font-medium text-foreground">Docker + Compose + Nginx</p>
						</div>
					</div>
					<motion.div
						className="mt-4"
						animate={prefersReducedMotion ? undefined : { y: [0, -4, 0] }}
						transition={prefersReducedMotion ? undefined : { duration: 7, repeat: Infinity, ease: "easeInOut" }}
					>
						<ScreenshotImage
							src="/screenshots/dashboard.png"
							alt="Smart Deploy dashboard overview"
						/>
					</motion.div>
				</div>
			</div>
		</motion.div>
	);
}

function WorkflowRail() {
	const prefersReducedMotion = useReducedMotion();

	return (
		<div className="relative">
			<motion.div
				className="landing-connector absolute left-12 right-12 top-11 hidden h-px origin-left lg:block"
				aria-hidden
				initial={prefersReducedMotion ? false : "hidden"}
				whileInView={prefersReducedMotion ? undefined : "show"}
				viewport={{ once: true, amount: 0.4 }}
				variants={drawLineVariants}
			/>
			<div className="grid gap-4 lg:grid-cols-4">
				{workflowSteps.map((step, index) => {
					const Icon = step.icon;

					return (
						<motion.div
							key={step.id}
							initial={prefersReducedMotion ? false : { opacity: 0, y: 26, scale: 0.98 }}
							whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
							viewport={{ once: true, amount: 0.25 }}
							transition={prefersReducedMotion ? undefined : { duration: 0.6, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
						>
							<div className="group landing-panel landing-shell relative h-full overflow-hidden p-5">
								<div className="landing-grid-overlay absolute inset-0 opacity-20" aria-hidden />
								<div className="relative z-10">
									<div className="flex items-center justify-between gap-4">
										<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
											<Icon className="size-5" />
										</div>
										<span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{step.id}</span>
									</div>
									<h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">{step.title}</h3>
									<p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
								</div>
							</div>
						</motion.div>
					);
				})}
			</div>
		</div>
	);
}

export function LandingExperience({ isSignedIn, publicMetrics }: LandingExperienceProps) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Open Smart Deploy";
	const prefersReducedMotion = useReducedMotion();

	useEffect(() => {
		const hash = window.location.hash;
		if (!hash) return;
		const targetId = decodeURIComponent(hash.slice(1));
		let canceled = false;
		const run = () => {
			if (canceled) return;
			const el = document.getElementById(targetId);
			if (!el) return;
			el.scrollIntoView({
				behavior: prefersReducedMotion ? "auto" : "smooth",
				block: "start",
			});
		};
		const rafId = requestAnimationFrame(() => requestAnimationFrame(run));
		return () => {
			canceled = true;
			cancelAnimationFrame(rafId);
		};
	}, [prefersReducedMotion]);

	return (
		<div className="landing-bg h-svh overflow-x-hidden overflow-y-auto scroll-smooth stealth-scrollbar pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] text-foreground md:pb-0">
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
					<div className="min-w-0 shrink">
						<SmartDeployLogo href="/" />
					</div>
					<nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:gap-8 md:flex" aria-label="Primary">
						<a href="#start-your-way" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Your way</a>
						<a href="#problem-solution" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Problem and solution</a>
						<a href="#comparison" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Comparison</a>
						<a href="#workflow" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">How it works</a>
					</nav>
					<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
						<Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
							<Link href="/docs">Docs</Link>
						</Button>
						<Button
							asChild
							size="sm"
							className="shadow-[0_18px_40px_-20px_rgba(37,244,106,0.45)] sm:h-9 sm:px-4 sm:text-sm"
						>
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
				<section className="landing-hero-bg relative overflow-hidden px-6 pb-12 pt-10 lg:px-10 lg:pb-16 lg:pt-12">
					<div className="landing-hero-wave absolute inset-x-0 top-0 h-112 opacity-55" aria-hidden />
					<div className="landing-grid-overlay absolute inset-0 opacity-30" aria-hidden />
					<div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
						<motion.div
							className="relative z-10"
							initial={prefersReducedMotion ? false : "hidden"}
							animate={prefersReducedMotion ? undefined : "show"}
							variants={containerVariants}
						>
							<motion.p
								className="text-xs font-semibold uppercase tracking-[0.28em] text-primary"
								variants={heroItemVariants}
							>
								For solo developers
							</motion.p>
							<motion.h1
								className="mt-4 max-w-xl text-[2rem] font-semibold leading-[1.12] tracking-tight text-foreground sm:max-w-2xl sm:text-4xl sm:leading-[1.1] lg:text-[2.65rem] lg:leading-[1.08]"
								variants={heroItemVariants}
							>
								Deploy your app without the black box.
							</motion.h1>
							<motion.p
								className="mt-4 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg"
								variants={heroItemVariants}
							>
								Bring or generate Docker, Compose, and Nginx. Preview the blueprint (your services and routing) before anything runs.
							</motion.p>
							<motion.div className="mt-8 flex flex-wrap gap-3" variants={heroItemVariants}>
								<Button asChild size="lg" className="gap-2 shadow-[0_18px_40px_-24px_rgba(37,244,106,0.45)]">
									<Link href={primaryHref}>
										{primaryCopy}
										<motion.span
											animate={prefersReducedMotion ? undefined : { x: [0, 4, 0] }}
											transition={prefersReducedMotion ? undefined : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
										>
											<ArrowRight className="size-4" />
										</motion.span>
									</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<a href="#start-your-way">Start your way</a>
								</Button>
							</motion.div>
						</motion.div>

						<div className="relative z-10">
							<HeroPreview />
						</div>
					</div>
					{publicMetrics && publicMetrics.totalCount > 0 ? (
						<div className="mx-auto mt-10 max-w-7xl w-full px-6 lg:px-10">
							<LandingMetricsStrip metrics={publicMetrics} />
						</div>
					) : null}
				</section>

				<section id="start-your-way" className={`border-b border-border/60 px-6 py-16 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Start your way"
							title="Bring your own config, or generate it"
							description="Either path ends the same way: real files, a blueprint you can read, and a deploy you choose, not one the platform surprises you with."
							align="center"
						/>
						<div className="mt-10 grid gap-5 md:grid-cols-2">
							<motion.div
								initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
								whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
								viewport={{ once: true, amount: 0.2 }}
								transition={prefersReducedMotion ? undefined : { duration: 0.55, ease: "easeOut" }}
							>
								<div className="landing-panel landing-shell h-full overflow-hidden p-6 sm:p-7">
									<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Your stack</p>
									<h3 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Bring your own Docker / Compose / Nginx</h3>
									<p className="mt-4 text-sm leading-6 text-muted-foreground">
										Already have a Dockerfile, `docker-compose.yml`, and routing config? Smart Deploy detects them and maps them into the blueprint so you can sanity-check the plan before anything runs.
									</p>
								</div>
							</motion.div>
							<motion.div
								initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
								whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
								viewport={{ once: true, amount: 0.2 }}
								transition={prefersReducedMotion ? undefined : { duration: 0.55, delay: 0.06, ease: "easeOut" }}
							>
								<div className="landing-panel landing-shell h-full overflow-hidden p-6 sm:p-7">
									<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">From the repo</p>
									<h3 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Or let Smart Deploy generate a starting point</h3>
									<p className="mt-4 text-sm leading-6 text-muted-foreground">
										No files yet? Generate a baseline, then edit like normal code. Either way you inspect and control everything before deploy. Nothing stays trapped behind the UI.
									</p>
								</div>
							</motion.div>
						</div>
					</div>
				</section>

				<section id="problem-solution" className={`border-y border-border/60 bg-muted/20 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Problem and solution"
							title="PaaS hides too much. Raw cloud exposes too much."
							description="Smart Deploy sits in the middle for solo developers, indie hackers, and small teams who want a simpler path to production without losing sight of how the app actually runs."
						/>

						<div className="mt-14 grid gap-5 lg:grid-cols-3">
							{storyCards.map((card, index) => (
								<motion.div
									key={card.title}
									initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
									whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
									viewport={{ once: true, amount: 0.2 }}
									transition={prefersReducedMotion ? undefined : { duration: 0.55, delay: index * 0.08, ease: "easeOut" }}
								>
									<div className="group landing-panel landing-shell relative h-full overflow-hidden p-6">
										<div className="landing-grid-overlay absolute inset-0 opacity-20" aria-hidden />
										<div className="relative z-10">
											<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{card.eyebrow}</p>
											<h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{card.title}</h3>
											<p className="mt-4 text-sm leading-6 text-muted-foreground">{card.description}</p>
										</div>
									</div>
								</motion.div>
							))}
						</div>
					</div>
				</section>

				<section id="comparison" className={`px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Comparison"
							title="Where Smart Deploy fits"
							description="Most deployment platforms force a tradeoff between simplicity and control. Smart Deploy is built to give you both - without hiding how your app runs."
							align="center"
						/>

						<MotionDiv className="mt-10">
							<div className="landing-panel landing-shell overflow-hidden">
								<div className="overflow-x-auto stealth-scrollbar">
									<table className="min-w-full border-collapse text-left text-sm">
										<thead>
											<tr className="border-b border-border/70 bg-background/60">
												<th className="px-5 py-4 font-semibold text-foreground">Platform</th>
												<th className="px-5 py-4 font-semibold text-foreground">Ease of use</th>
												<th className="px-5 py-4 font-semibold text-foreground">Visibility into infrastructure</th>
											</tr>
										</thead>
										<tbody>
											{comparisonRows.map((row) => (
												<tr
													key={row.platform}
													className={row.highlight
														? "border-b border-border/60 bg-primary/8 last:border-b-0"
														: "border-b border-border/60 bg-background/30 last:border-b-0"}
												>
													<td className="px-5 py-4 font-medium text-foreground">{row.platform}</td>
													<td className="px-5 py-4 text-muted-foreground">{row.ease}</td>
													<td className="px-5 py-4 text-muted-foreground">{row.visibility}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						</MotionDiv>

						<p className="mt-6 text-sm font-medium text-foreground">
							Deploy like a PaaS. Understand it like the cloud.
						</p>
					</div>
				</section>

				<section id="workflow" className={`border-t border-border/60 bg-muted/20 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="How it works"
							title="A deployment flow you can actually read"
							description="One loop: write or generate files, preview the blueprint, open the real Docker / Compose / Nginx artifacts, then deploy from the same workspace."
						/>

						<div className="mt-14">
							<WorkflowRail />
						</div>
					</div>
				</section>
			</main>

			<PublicPageFooterContent primaryHref={primaryHref} />

			<PublicBottomNav links={landingMobileNavLinks} />
		</div>
	);
}
