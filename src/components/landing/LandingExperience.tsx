"use client";

import * as React from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion";
import {
	ArrowRight,
	Bot,
	CheckCircle2,
	CloudCog,
	Container,
	Globe,
	HeartPulse,
	ShieldCheck,
	Sparkles,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LandingBackground } from "@/components/landing/LandingBackground";
import { ScrollytellingSection } from "@/components/landing/ScrollytellingSection";
import { PublicBottomNav, type MobileNavLink } from "@/components/public/PublicBottomNav";
import { PublicPageFooterContent } from "@/components/public/PublicPageFooterContent";
import { Button } from "@/components/ui/button";
import type { LandingPublicStats } from "@/lib/metrics/landingStats";

type LandingExperienceProps = {
	isSignedIn: boolean;
	publicStats: LandingPublicStats | null;
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
		detail: "AI does more than chat. It diagnoses failures, repairs build plans, and inspects live deployments on request.",
		proof: "Root-cause analysis, Improve Scan, and a read-only Deployment Agent.",
		icon: Sparkles,
	},
];

const landingMobileNavLinks: MobileNavLink[] = [
	{ href: "#flow", label: "Flow" },
	{ href: "#agent", label: "Agent" },
	{ href: "#why-smartdeploy", label: "Why" },
	{ href: "#cloud", label: "Deploy" },
];

const supportedJsFrameworks = [
	"React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "SvelteKit",
	"Remix", "Astro", "Gatsby", "Express", "NestJS", "Fastify", "Hono", "Koa",
];

const supportedPythonFrameworks = [
	"Django", "Flask", "FastAPI", "Starlette", "Sanic", "Falcon",
	"Tornado", "Pyramid", "Bottle", "CherryPy", "Streamlit", "Dash", "Gradio",
];

type DeployTarget = {
	name: string;
	tagline: string;
	bestFor: string;
	pipeline: string[];
	icon: LucideIcon;
};

const DEPLOY_TARGETS: DeployTarget[] = [
	{
		name: "ECS Fargate",
		tagline: "Containers & server apps",
		bestFor: "Railpack builds, server apps, and existing Docker images.",
		pipeline: ["CodeBuild", "ECR", "Fargate", "ALB route"],
		icon: Container,
	},
	{
		name: "Static S3",
		tagline: "SPAs & static builds",
		bestFor: "Build-only sites with no runtime, served from S3.",
		pipeline: ["CodeBuild", "S3 sync", "CloudFront"],
		icon: Globe,
	},
];

const SUPPORTED_FRAMEWORK_GROUPS = [
	{ id: "js", title: "JavaScript / TypeScript", frameworks: supportedJsFrameworks },
	{ id: "python", title: "Python", frameworks: supportedPythonFrameworks },
] as const;

type AgentCapability = {
	title: string;
	detail: string;
	icon: LucideIcon;
};

const AGENT_CAPABILITIES: AgentCapability[] = [
	{
		title: "Inspect live state",
		detail: "Status, branch, region, commit, and cloud resources for any deployment.",
		icon: CheckCircle2,
	},
	{
		title: "Explain failures",
		detail: "Pulls recent history and the failed step so you know why a deploy broke.",
		icon: Wrench,
	},
	{
		title: "Check runtime health",
		detail: "Reads app probes plus ECS and ALB signals — healthy, degraded, or unreachable.",
		icon: HeartPulse,
	},
];

const AGENT_TOOL_CHIPS = ["list_deployments", "get_deployment_details", "get_deployment_history", "get_runtime_health"] as const;

const sectionAnchorClass = "scroll-mt-20 sm:scroll-mt-24";

const TYPED_WORDS = ["Next.js app", "Flask API", "monorepo", "microservice", "side project"];
const LONGEST_TYPED_WORD = TYPED_WORDS.reduce((longest, word) => {
	if (word.length > longest.length) return word;
	if (word.length < longest.length) return longest;
	return word.includes(" ") ? word : longest;
});
const TYPING_SPEED_MS = 80;
const PAUSE_MS = 2200;
const DELETE_SPEED_MS = 40;

function useTypedText(words: string[]) {
	// Seed with the first full word so server-rendered HTML (and any crawler that
	// reads it) shows "Deploy your <word> without the black box." instead of a gap.
	// The client picks up from this state and animates normally.
	const [display, setDisplay] = React.useState(words[0] ?? "");
	const [wordIndex, setWordIndex] = React.useState(0);
	const [isDeleting, setIsDeleting] = React.useState(false);

	React.useEffect(() => {
		const current = words[wordIndex];
		let timeout: ReturnType<typeof setTimeout>;

		if (!isDeleting && display === current) {
			timeout = setTimeout(() => setIsDeleting(true), PAUSE_MS);
		} else if (isDeleting && display === "") {
			timeout = setTimeout(() => {
				setIsDeleting(false);
				setWordIndex((prev) => (prev + 1) % words.length);
			}, 0);
		} else if (isDeleting) {
			timeout = setTimeout(() => setDisplay((prev) => prev.slice(0, -1)), DELETE_SPEED_MS);
		} else {
			timeout = setTimeout(
				() => setDisplay((prev) => current.slice(0, prev.length + 1)),
				TYPING_SPEED_MS
			);
		}

		return () => clearTimeout(timeout);
	}, [display, isDeleting, wordIndex, words]);

	return display;
}

function HeroSection({
	primaryHref,
	primaryCopy,
	prefersReducedMotion,
}: {
	primaryHref: string;
	primaryCopy: string;
	prefersReducedMotion: boolean | null;
}) {
	const typedText = useTypedText(TYPED_WORDS);

	return (
		<section className="relative overflow-hidden px-6 sm:px-8 lg:px-10">
			<div className="relative z-10 mx-auto flex min-h-[calc(100svh-3.75rem)] w-full max-w-5xl flex-col items-center justify-center py-14 text-center sm:min-h-[calc(100svh-4.25rem)] sm:py-16 lg:py-20">
				<m.div
					initial={prefersReducedMotion ? false : { opacity: 0, y: 32 }}
					animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
					transition={prefersReducedMotion ? undefined : { duration: 0.7, ease: "easeOut" }}
				>
					<p className="mb-5 inline-block rounded-full border border-white/10 bg-white/4 px-4 py-1.5 text-xs font-medium tracking-wide text-white/60">
						Scan &middot; Preview &middot; Deploy &middot; Recover
					</p>
				</m.div>

				<m.h1
					initial={prefersReducedMotion ? false : { opacity: 0, y: 28 }}
					animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
					transition={prefersReducedMotion ? undefined : { duration: 0.65, ease: "easeOut", delay: 0.08 }}
					className="max-w-4xl text-[2.6rem] font-bold leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl"
				>
					<span className="block sm:inline" data-testid="landing-hero-prefix">Deploy your</span>
					<span className="hidden sm:inline">&nbsp;</span>
					<span
						className="mt-2 block min-h-[1.1em] sm:mt-0 sm:inline-block sm:min-h-0"
						data-testid="landing-typed-line"
					>
						<span className="relative inline-block whitespace-nowrap text-left">
							<span aria-hidden="true" className="invisible select-none landing-hero-typed-text">
								{LONGEST_TYPED_WORD}
							</span>
							<span className="absolute inset-y-0 left-0 inline-flex items-baseline">
								<span className="landing-hero-typed-text">{typedText}</span>
								<span className="landing-hero-cursor" />
							</span>
						</span>
					</span>
					<br />
					<span className="bg-linear-to-r from-white via-white/90 to-white/60 bg-clip-text text-transparent">
						without the black box.
					</span>
				</m.h1>

				<m.p
					initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
					animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
					transition={prefersReducedMotion ? undefined : { duration: 0.55, ease: "easeOut", delay: 0.16 }}
					className="mt-7 max-w-xl text-lg leading-8 text-white/55 sm:text-xl"
				>
					AI scans your repo, generates the build plan, shows you the full blueprint, and ships to AWS — with live logs, runtime health, and recovery built in.
				</m.p>

				<m.div
					initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
					animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
					transition={prefersReducedMotion ? undefined : { duration: 0.5, ease: "easeOut", delay: 0.24 }}
					className="mt-10 flex flex-wrap items-center justify-center gap-3"
				>
					<Button asChild size="lg" className="gap-2 shadow-[0_18px_40px_-24px_rgba(59,130,246,0.55)]">
						<Link href={primaryHref}>
							{primaryCopy}
							<ArrowRight className="size-4" />
						</Link>
					</Button>
					<Button
						asChild
						size="lg"
						variant="outline"
						className="border-white/16 bg-white/3 text-white hover:bg-white/8 hover:text-white"
					>
						<a href="#flow">See the Flow</a>
					</Button>
				</m.div>
			</div>
		</section>
	);
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
					<m.div
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
					</m.div>
				);
			})}
		</div>
	);
}

function DeployTargets() {
	const prefersReducedMotion = useReducedMotion();
	return (
		<div className="grid gap-4 md:grid-cols-2">
			{DEPLOY_TARGETS.map((target, index) => {
				const Icon = target.icon;
				return (
					<m.div
						key={target.name}
						initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
						whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
						viewport={{ once: true, amount: 0.25 }}
						transition={prefersReducedMotion ? undefined : { duration: 0.45, delay: index * 0.08, ease: "easeOut" }}
						className="landing-panel landing-shell p-6"
					>
						<div className="flex items-center gap-3">
							<div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
								<Icon className="size-5" />
							</div>
							<div>
								<h3 className="text-lg font-semibold text-foreground">{target.name}</h3>
								<p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{target.tagline}</p>
							</div>
						</div>
						<p className="mt-4 text-sm leading-6 text-muted-foreground">{target.bestFor}</p>
						<div className="mt-5 flex flex-wrap items-center gap-1.5">
							{target.pipeline.map((stage, stageIndex) => (
								<React.Fragment key={stage}>
									<span className="rounded-md border border-border/60 bg-background/75 px-2.5 py-1 font-mono text-[11px] text-foreground">
										{stage}
									</span>
									{stageIndex < target.pipeline.length - 1 && (
										<ArrowRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
									)}
								</React.Fragment>
							))}
						</div>
					</m.div>
				);
			})}
		</div>
	);
}

function SupportedFrameworks() {
	return (
		<div className="grid gap-4 lg:grid-cols-2">
			{SUPPORTED_FRAMEWORK_GROUPS.map((group) => (
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

function AnimatedCounter({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
	const cardRef = React.useRef<HTMLDivElement>(null);
	const numberRef = React.useRef<HTMLParagraphElement>(null);
	const hasAnimated = React.useRef(false);

	// The real value is rendered directly in JSX (so server HTML and crawlers see
	// it). When the card nears the viewport we count up imperatively via a ref —
	// no React state, so there are no extra renders and the number is never stale.
	React.useEffect(() => {
		const card = cardRef.current;
		const number = numberRef.current;
		if (!card || !number || hasAnimated.current) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		const format = (current: number) => `${current.toLocaleString()}${suffix}`;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting || hasAnimated.current) return;
				hasAnimated.current = true;
				observer.disconnect();

				const duration = 1600;
				const start = performance.now();
				const animate = (now: number) => {
					const progress = Math.min((now - start) / duration, 1);
					const eased = 1 - Math.pow(1 - progress, 3);
					number.textContent = format(Math.round(eased * value));
					if (progress < 1) requestAnimationFrame(animate);
				};
				requestAnimationFrame(animate);
			},
			// The bottom rootMargin starts the count-up just before the card scrolls
			// into view, so the reset to 0 happens off-screen with no flash.
			{ threshold: 0, rootMargin: "0px 0px 240px 0px" }
		);
		observer.observe(card);
		return () => observer.disconnect();
	}, [value, suffix]);

	return (
		<div ref={cardRef} className="landing-stat-card group">
			<div className="landing-stat-glow" aria-hidden />
			<p
				ref={numberRef}
				className="relative z-10 font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
			>
				{value.toLocaleString()}{suffix}
			</p>
			<p className="relative z-10 mt-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
				{label}
			</p>
		</div>
	);
}

function LivePulseStats({ stats }: { stats: LandingPublicStats }) {
	const prefersReducedMotion = useReducedMotion();
	const items = [
		{ value: stats.totalDeployments, label: "Deployments shipped", suffix: "" },
		{ value: stats.totalAnalyses, label: "AI analyses run", suffix: "" },
		{ value: stats.totalArtifacts, label: "Artifacts generated", suffix: "" },
	].filter((item) => item.value > 0);

	if (items.length === 0) return null;

	return (
		<m.div
			initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
			whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.2 }}
			transition={prefersReducedMotion ? undefined : { duration: 0.5, ease: "easeOut" }}
			className="landing-stats-strip"
		>
			<div className="landing-stats-strip-track" aria-hidden />
			<div className="relative z-10 grid w-full gap-4 sm:grid-cols-3">
				{items.map((item) => (
					<AnimatedCounter key={item.label} value={item.value} label={item.label} suffix={item.suffix} />
				))}
			</div>
		</m.div>
	);
}

function AgentChatMock() {
	const prefersReducedMotion = useReducedMotion();
	const reveal = (delay: number) =>
		prefersReducedMotion
			? {}
			: {
					initial: { opacity: 0, y: 10 },
					whileInView: { opacity: 1, y: 0 },
					viewport: { once: true, amount: 0.4 },
					transition: { duration: 0.4, delay, ease: "easeOut" as const },
				};

	return (
		<div className="landing-panel landing-shell relative overflow-hidden p-4 sm:p-5">
			<div className="landing-grid-overlay pointer-events-none absolute inset-0 opacity-20" aria-hidden />
			<div className="relative z-10">
				<div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
					<div className="flex items-center gap-2.5">
						<div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
							<Bot className="size-4" />
						</div>
						<div>
							<p className="text-xs font-semibold text-foreground">Deployment Agent</p>
							<p className="text-[10px] text-muted-foreground">Read-only inspector</p>
						</div>
					</div>
					<span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
						Online
					</span>
				</div>

				<div className="mt-4 space-y-3">
					<m.div {...reveal(0)} className="flex justify-end">
						<p className="max-w-[80%] rounded-2xl rounded-br-sm border border-border/60 bg-card/80 px-3 py-2 text-xs text-foreground">
							Is my api service healthy right now?
						</p>
					</m.div>

					<m.div {...reveal(0.12)} className="flex flex-wrap items-center gap-1.5">
						<span className="rounded-md border border-accent/35 bg-accent/10 px-2 py-1 font-mono text-[10px] text-accent">
							tool: get_runtime_health
						</span>
						<span className="text-[10px] text-muted-foreground">completed</span>
					</m.div>

					<m.div {...reveal(0.24)} className="flex justify-start">
						<div className="max-w-[88%] space-y-2.5 rounded-2xl rounded-bl-sm border border-primary/25 bg-primary/6 px-3 py-2.5">
							<p className="text-xs leading-5 text-foreground">
								<span className="font-mono">api@smart-deploy</span> is <span className="font-semibold text-primary">healthy</span> — the last probe returned HTTP 200 and ECS tasks match desired.
							</p>
							<div className="grid grid-cols-3 gap-1.5">
								<div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">
									<p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">HTTP</p>
									<p className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">200</p>
								</div>
								<div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">
									<p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Latency</p>
									<p className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">82ms</p>
								</div>
								<div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">
									<p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">ECS</p>
									<p className="mt-0.5 font-mono text-[11px] font-semibold text-foreground">2/2</p>
								</div>
							</div>
						</div>
					</m.div>
				</div>
			</div>
		</div>
	);
}

function DeploymentAgentSection() {
	const prefersReducedMotion = useReducedMotion();
	return (
		<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
			<div>
				<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">AI Operations</p>
				<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
					Ask your deployments anything
				</h2>
				<p className="mt-4 text-base leading-7 text-muted-foreground">
					The Deployment Agent answers from <em>your</em> live data — status, history, and runtime health — by calling read-only tools. It never guesses repos or services, and it cannot deploy, roll back, or change config from chat.
				</p>

				<ul className="mt-8 space-y-3">
					{AGENT_CAPABILITIES.map((capability, index) => {
						const Icon = capability.icon;
						return (
							<m.li
								key={capability.title}
								initial={prefersReducedMotion ? false : { opacity: 0, x: -10 }}
								whileInView={prefersReducedMotion ? undefined : { opacity: 1, x: 0 }}
								viewport={{ once: true, amount: 0.4 }}
								transition={prefersReducedMotion ? undefined : { duration: 0.4, delay: index * 0.08, ease: "easeOut" }}
								className="flex items-start gap-3"
							>
								<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
									<Icon className="size-4" />
								</div>
								<div>
									<p className="text-sm font-semibold text-foreground">{capability.title}</p>
									<p className="text-sm leading-6 text-muted-foreground">{capability.detail}</p>
								</div>
							</m.li>
						);
					})}
				</ul>

				<div className="mt-7 flex flex-wrap gap-1.5">
					{AGENT_TOOL_CHIPS.map((tool) => (
						<span
							key={tool}
							className="rounded-md border border-border/60 bg-background/75 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
						>
							{tool}
						</span>
					))}
				</div>
			</div>

			<AgentChatMock />
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
					Smart Deploy gives you fast shipping, an inspectable blueprint, runtime health, and AI-guided recovery in one workflow.
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

export function LandingExperience({ isSignedIn, publicStats }: LandingExperienceProps) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Get Started Free";
	const prefersReducedMotion = useReducedMotion();

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
		<LazyMotion features={domAnimation} strict>
		<div className="landing-bg h-svh overflow-x-hidden overflow-y-auto stealth-scrollbar pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] text-foreground md:pb-0">
			<LandingBackground />
			<div className="relative z-10">
			<header className="sticky top-0 z-50 border-b border-border/55 bg-background/70 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
					<div className="min-w-0 shrink">
						<SmartDeployLogo href="/" />
					</div>
					<nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:gap-8 md:flex" aria-label="Primary">
						<a href="#flow" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Flow</a>
						<a href="#agent" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Agent</a>
						<a href="#why-smartdeploy" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Why</a>
						<a href="#cloud" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Deploy</a>
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
				<HeroSection
					primaryHref={primaryHref}
					primaryCopy={primaryCopy}
					prefersReducedMotion={prefersReducedMotion}
				/>

				<ScrollytellingSection />

				<section id="agent" className={`border-t border-border/60 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<DeploymentAgentSection />
					</div>
				</section>

				<section id="why-smartdeploy" className={`border-t border-border/60 bg-muted/20 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
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

				<section id="cloud" className={`border-t border-border/60 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Deploy Targets"
							title="Real AWS infrastructure, fully previewed"
							description="Smart Deploy routes each service to the right AWS target based on its scan — containers to ECS Fargate, static builds to S3 and CloudFront."
						/>
						<div className="mt-12">
							<DeployTargets />
						</div>
						<div className="mt-12">
							<SupportedFrameworks />
						</div>
					</div>
				</section>

				{publicStats ? (
					<section className={`border-t border-border/60 px-6 py-20 lg:px-10 ${sectionAnchorClass}`}>
						<div className="mx-auto max-w-5xl">
							<LivePulseStats stats={publicStats} />
						</div>
					</section>
				) : null}

				<section className="border-t border-border/60 bg-muted/20 px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<FinalCTA primaryHref={primaryHref} primaryCopy={primaryCopy} />
					</div>
				</section>
			</main>

			<PublicPageFooterContent primaryHref={primaryHref} />
			<PublicBottomNav links={landingMobileNavLinks} />
			</div>
		</div>
		</LazyMotion>
	);
}
