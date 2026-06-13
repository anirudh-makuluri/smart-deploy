"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion";
import {
	ArrowRight,
	CloudCog,
	ShieldCheck,
	Sparkles,
	type LucideIcon,
} from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
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
		detail: "AI does more than chat. It explains failures and helps regenerate safer deploy artifacts.",
		proof: "Root-cause analysis + Improve Scan Results chain.",
		icon: Sparkles,
	},
];

const landingMobileNavLinks: MobileNavLink[] = [
	{ href: "#flow", label: "Flow" },
	{ href: "#why-smartdeploy", label: "Why" },
	{ href: "#cloud", label: "Cloud" },
];

const supportedJsFrameworks = [
	"React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "SvelteKit",
	"Remix", "Astro", "Gatsby", "Express", "NestJS", "Fastify", "Hono", "Koa",
];

const supportedPythonFrameworks = [
	"Django", "Flask", "FastAPI", "Starlette", "Sanic", "Falcon",
	"Tornado", "Pyramid", "Bottle", "CherryPy", "Streamlit", "Dash", "Gradio",
];

const CLOUD_PROVIDERS = [
	{ name: "AWS", logo: "/logos/aws.svg" },
	{ name: "GCP", logo: "/logos/google-cloud.svg" },
] as const;

const SUPPORTED_FRAMEWORK_GROUPS = [
	{ id: "js", title: "JavaScript / TypeScript", frameworks: supportedJsFrameworks },
	{ id: "python", title: "Python", frameworks: supportedPythonFrameworks },
] as const;

const sectionAnchorClass = "scroll-mt-20 sm:scroll-mt-24";

const TYPED_WORDS = ["Next.js app", "Flask API", "monorepo", "microservice", "side project"];
const TYPING_SPEED_MS = 80;
const PAUSE_MS = 2200;
const DELETE_SPEED_MS = 40;

function useTypedText(words: string[]) {
	const [display, setDisplay] = React.useState("");
	const [wordIndex, setWordIndex] = React.useState(0);
	const [isDeleting, setIsDeleting] = React.useState(false);

	React.useEffect(() => {
		const current = words[wordIndex];
		let timeout: ReturnType<typeof setTimeout>;

		if (!isDeleting && display === current) {
			timeout = setTimeout(() => setIsDeleting(true), PAUSE_MS);
		} else if (isDeleting && display === "") {
			setIsDeleting(false);
			setWordIndex((prev) => (prev + 1) % words.length);
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

function HeroOrb() {
	return (
		<div className="landing-hero-orb-container" aria-hidden>
			<div className="landing-hero-orb" />
			<div className="landing-hero-orb-ring landing-hero-orb-ring-1" />
			<div className="landing-hero-orb-ring landing-hero-orb-ring-2" />
			<div className="landing-hero-orb-ring landing-hero-orb-ring-3" />
		</div>
	);
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
		<section className="landing-hero-bg relative overflow-hidden px-6 sm:px-8 lg:px-10">
			<HeroOrb />
			<div className="landing-hero-grid-bg" aria-hidden />
			<div className="relative z-10 mx-auto flex min-h-[calc(92svh-4.5rem)] w-full max-w-5xl flex-col items-center justify-center py-14 text-center sm:py-16 lg:min-h-[calc(88svh-4.5rem)] lg:py-20">
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
					className="max-w-4xl text-5xl font-bold leading-[1.05] tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl"
				>
					Deploy your{" "}
					<span className="relative inline-block min-w-[3ch] text-left">
						<span className="landing-hero-typed-text">{typedText}</span>
						<span className="landing-hero-cursor" />
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
					AI scans your repo, generates deploy artifacts, shows you the full blueprint, and ships it — with recovery built in.
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

function CloudProviders() {
	return (
		<ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
			{CLOUD_PROVIDERS.map((provider) => (
				<li key={provider.name} className="flex items-center gap-2.5 text-foreground">
					<Image src={provider.logo} alt={`${provider.name} logo`} width={28} height={28} className="size-7" />
					<span className="text-base font-semibold">{provider.name}</span>
				</li>
			))}
		</ul>
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
	const [displayed, setDisplayed] = React.useState(0);
	const ref = React.useRef<HTMLDivElement>(null);
	const hasAnimated = React.useRef(false);

	React.useEffect(() => {
		if (!ref.current || hasAnimated.current) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting || hasAnimated.current) return;
				hasAnimated.current = true;
				observer.disconnect();

				const duration = 1600;
				const start = performance.now();
				const animate = (now: number) => {
					const elapsed = now - start;
					const progress = Math.min(elapsed / duration, 1);
					const eased = 1 - Math.pow(1 - progress, 3);
					setDisplayed(Math.round(eased * value));
					if (progress < 1) requestAnimationFrame(animate);
				};
				requestAnimationFrame(animate);
			},
			{ threshold: 0.3 }
		);
		observer.observe(ref.current);
		return () => observer.disconnect();
	}, [value]);

	return (
		<div ref={ref} className="landing-stat-card group">
			<div className="landing-stat-glow" aria-hidden />
			<p className="relative z-10 font-mono text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
				{displayed.toLocaleString()}{suffix}
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
				{items.map((item, i) => (
					<AnimatedCounter key={i} value={item.value} label={item.label} suffix={item.suffix} />
				))}
			</div>
		</m.div>
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
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
					<div className="min-w-0 shrink">
						<SmartDeployLogo href="/" />
					</div>
					<nav className="hidden items-center gap-6 text-sm text-muted-foreground lg:gap-8 md:flex" aria-label="Primary">
						<a href="#flow" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Flow</a>
						<a href="#why-smartdeploy" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Why</a>
						<a href="#cloud" className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Cloud</a>
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
		</LazyMotion>
	);
}
