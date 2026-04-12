"use client";

import React from "react";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
	ArrowRight,
	CheckCircle2,
	ExternalLink,
	Github,
	ImageOff,
	type LucideIcon,
	Rocket,
	ScanSearch,
	SquareTerminal,
} from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Button } from "@/components/ui/button";

type LandingExperienceProps = {
	isSignedIn: boolean;
};

type ProductPillar = {
	eyebrow: string;
	title: string;
	description: string;
	icon: LucideIcon;
};

type WorkflowStep = {
	id: string;
	title: string;
	description: string;
	icon: LucideIcon;
};

type ScreenshotSlot = {
	eyebrow: string;
	title: string;
	description: string;
	imageSrc: string;
	imageAlt: string;
};

type ProductMetric = {
	value: number;
	suffix?: string;
	label: string;
	description: string;
};

const productPillars: ProductPillar[] = [
	{
		eyebrow: "Repository Intake",
		title: "Turn a GitHub repo into a deployable surface.",
		description:
			"SmartDeploy inspects the repo, detects the moving parts, and shows what needs to ship before you touch infrastructure.",
		icon: Github,
	},
	{
		eyebrow: "Release Blueprint",
		title: "Surface the rollout path before you deploy.",
		description:
			"Blueprints, runtime checks, and dependency signals keep the release plan visible before provisioning starts.",
		icon: ScanSearch,
	},
	{
		eyebrow: "Live Operations",
		title: "Keep rollout state, logs, and preview in one live view.",
		description:
			"Build output, runtime feedback, and the live app stay connected so validation happens in one place instead of across tabs.",
		icon: SquareTerminal,
	},
];

const workflowSteps: WorkflowStep[] = [
	{
		id: "01",
		title: "Connect a repository",
		description: "Import a GitHub repo, detect services, and establish the deployable surface in seconds.",
		icon: Github,
	},
	{
		id: "02",
		title: "Generate the blueprint",
		description: "Run Smart Analysis to inspect runtime needs, service layout, and deployment constraints before rollout.",
		icon: ScanSearch,
	},
	{
		id: "03",
		title: "Deploy with context",
		description: "Configure the release path with the blueprint, branches, and operational details already attached.",
		icon: Rocket,
	},
	{
		id: "04",
		title: "Validate the release",
		description: "Watch logs, rollout status, and preview output without bouncing across separate tools.",
		icon: CheckCircle2,
	},
];

const screenshotSlots: ScreenshotSlot[] = [
	{
		eyebrow: "Workspace",
		title: "Repository intake and service detection",
		description:
			"Import GitHub repositories and let SmartDeploy automatically detect services, runtimes, and branch-level status across your workspace.",
		imageSrc: "/screenshots/repo-overview.png",
		imageAlt: "SmartDeploy workspace showing imported repositories and detected services",
	},
	{
		eyebrow: "Analysis",
		title: "Smart Analysis and deployment blueprint",
		description:
			"Inspect runtime requirements, service dependencies, and deployment constraints before a single resource is provisioned.",
		imageSrc: "/screenshots/smart-analysis.png",
		imageAlt: "SmartDeploy analysis output showing the generated deployment blueprint",
	},
	{
		eyebrow: "Deploy",
		title: "Deployment logs and live preview",
		description:
			"Monitor rollout status, stream build and runtime logs, and preview the live application from one operational surface.",
		imageSrc: "/screenshots/deploy-preview.png",
		imageAlt: "SmartDeploy deployment view with logs and live preview side by side",
	},
];

const productMetrics: ProductMetric[] = [
	{
		value: 4,
		label: "Workflow steps",
		description: "A short path from repository intake through release validation.",
	},
	{
		value: 1,
		label: "Shared workspace",
		description: "Blueprints, deploy state, logs, and preview stay connected in one view.",
	},
	{
		value: 3,
		label: "Core surfaces",
		description: "Repository intelligence, decision support, and operational visibility.",
	},
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

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
	return (
		<span>
			{value}
			{suffix}
		</span>
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
					<p className="text-sm font-medium text-muted-foreground">Screenshot coming soon</p>
					<p className="mt-1 text-xs text-muted-foreground/70">Product capture will appear here</p>
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
			<motion.div
				className="landing-panel landing-shell relative overflow-hidden p-3 sm:p-4"
				whileHover={prefersReducedMotion ? undefined : { y: -6, rotateX: -2, rotateY: 2 }}
				transition={{ duration: 0.35, ease: "easeOut" }}
			>
				<div className="landing-grid-overlay absolute inset-0 opacity-40" aria-hidden />
				<div className="landing-orbital-ring absolute inset-6 rounded-[28px] opacity-70" aria-hidden />
				<div className="relative z-10">
					<div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/60 px-4 py-3">
						<div className="flex items-center gap-2">
							<span className="size-2.5 rounded-full bg-rose-400/80" />
							<span className="size-2.5 rounded-full bg-amber-300/80" />
							<span className="size-2.5 rounded-full bg-emerald-400/80" />
						</div>
						<span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
							<span className="size-2 rounded-full bg-primary" />
							SmartDeploy
						</span>
					</div>
					<motion.div
						className="mt-3"
						animate={prefersReducedMotion ? undefined : { y: [0, -5, 0] }}
						transition={prefersReducedMotion ? undefined : { duration: 7, repeat: Infinity, ease: "easeInOut" }}
					>
						<ScreenshotImage
							src="/screenshots/dashboard.png"
							alt="SmartDeploy dashboard overview"
						/>
					</motion.div>
				</div>
			</motion.div>
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
						<motion.div
							className="group landing-panel landing-shell relative h-full overflow-hidden p-5"
							whileHover={prefersReducedMotion ? undefined : { y: -6 }}
							transition={{ duration: 0.25, ease: "easeOut" }}
						>
							<div className="landing-grid-overlay absolute inset-0 opacity-25" aria-hidden />
							<div className="landing-card-glow absolute inset-x-6 top-0 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
							<div className="relative z-10">
								<div className="flex items-center justify-between gap-4">
									<motion.div
										className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
										whileHover={prefersReducedMotion ? undefined : { scale: 1.08, rotate: -4 }}
										transition={{ duration: 0.25, ease: "easeOut" }}
									>
										<Icon className="size-5" />
									</motion.div>
									<span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">{step.id}</span>
								</div>
								<h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">{step.title}</h3>
								<p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>
							</div>
						</motion.div>
					</motion.div>
				);
				})}
			</div>
		</div>
	);
}

function ScreenshotCard({
	slot,
	index,
}: {
	slot: ScreenshotSlot;
	index: number;
}) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<motion.div
			initial={prefersReducedMotion ? false : { opacity: 0, y: 26 }}
			whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.2 }}
			transition={prefersReducedMotion ? undefined : { duration: 0.65, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
		>
			<motion.div
				className="landing-panel landing-shell overflow-hidden p-5 lg:p-6"
				whileHover={prefersReducedMotion ? undefined : { y: -4 }}
				transition={{ duration: 0.25, ease: "easeOut" }}
			>
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{slot.eyebrow}</p>
				<div className="mt-5 landing-shot relative overflow-hidden rounded-[28px] border border-border/75 bg-card/80 p-3">
					<div className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
						<div className="flex items-center gap-2">
							<span className="size-2.5 rounded-full bg-rose-400/80" />
							<span className="size-2.5 rounded-full bg-amber-300/80" />
							<span className="size-2.5 rounded-full bg-emerald-400/80" />
						</div>
						<span className="rounded-full border border-border/70 bg-card/80 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
							{slot.eyebrow}
						</span>
					</div>
					<motion.div
						className="mt-3"
						whileHover={prefersReducedMotion ? undefined : { y: -4, scale: 1.01 }}
						transition={{ duration: 0.25, ease: "easeOut" }}
					>
						<ScreenshotImage src={slot.imageSrc} alt={slot.imageAlt} />
					</motion.div>
				</div>
				<h3 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">{slot.title}</h3>
				<p className="mt-3 text-base leading-7 text-muted-foreground">{slot.description}</p>
			</motion.div>
		</motion.div>
	);
}

export function LandingExperience({ isSignedIn }: LandingExperienceProps) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Start Deploying";
	const prefersReducedMotion = useReducedMotion();

	return (
		<div className="landing-bg min-h-svh text-foreground">
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-4">
					<SmartDeployLogo href="/" />
					<nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
						<Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
						<Link href="#workflow" className="transition-colors hover:text-foreground">Workflow</Link>
						<Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link>
						<Link href="/changelog" className="transition-colors hover:text-foreground">Changelog</Link>
						<Link href="#product" className="hidden transition-colors hover:text-foreground">Product</Link>
					</nav>
					<div className="flex items-center gap-3">
						<Button asChild variant="outline" className="hidden">
							<Link href="#product">See the product</Link>
						</Button>
						<Button asChild className="shadow-[0_18px_40px_-20px_rgba(59,130,246,0.85)]">
							<Link href={primaryHref}>{primaryCopy}</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				<section className="landing-hero-bg relative overflow-hidden px-6 pb-12 pt-10 lg:px-10 lg:pb-16 lg:pt-12">
					<div className="landing-hero-wave absolute inset-x-0 top-0 h-112 opacity-70" aria-hidden />
					<div className="landing-grid-overlay absolute inset-0 opacity-45" aria-hidden />
					<div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
						<motion.div
							className="relative z-10"
							initial={prefersReducedMotion ? false : "hidden"}
							animate={prefersReducedMotion ? undefined : "show"}
							variants={containerVariants}
						>
							<motion.h1
								className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[0.95]"
								variants={heroItemVariants}
							>
								Turn a GitHub repo into a production release without losing context.
							</motion.h1>
							<motion.p
								className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg"
								variants={heroItemVariants}
							>
								Connect a repo, let Smart Analysis map runtime and service layout, then deploy with logs, status, and preview still in frame.
							</motion.p>
							<motion.div className="mt-7 flex flex-wrap gap-3" variants={heroItemVariants}>
								<Button asChild size="lg" className="gap-2 shadow-[0_18px_40px_-24px_rgba(59,130,246,0.9)]">
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
									<Link href="#capabilities">Learn more</Link>
								</Button>
							</motion.div>

							<motion.div className="mt-7 grid gap-3 sm:grid-cols-3" variants={heroItemVariants}>
								{productMetrics.map((metric) => (
									<div key={metric.label} className="landing-panel landing-shell group overflow-hidden px-4 py-3 sm:px-5">
										<div className="landing-card-glow absolute inset-x-6 top-0 h-16 opacity-70" aria-hidden />
										<p className="relative z-10 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
											<CountUp value={metric.value} suffix={metric.suffix} />
										</p>
										<p className="relative z-10 mt-2 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
											{metric.label}
										</p>
										<p className="relative z-10 mt-1.5 text-sm leading-5 text-muted-foreground">
											{metric.description}
										</p>
									</div>
								))}
							</motion.div>
						</motion.div>

						<div className="relative z-10">
							<HeroPreview />
						</div>
					</div>
				</section>

				<section id="capabilities" className="border-y border-border/60 bg-muted/20 px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Capabilities"
							title="Built for the hard parts of shipping."
							description="SmartDeploy focuses on the real bottlenecks: repo intake, release planning, and live operational visibility once code is moving."
							align="center"
						/>

						<div className="mt-14 grid gap-5 lg:grid-cols-3">
							{productPillars.map((pillar, index) => {
								const Icon = pillar.icon;

								return (
									<motion.div
										key={pillar.title}
										initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
										whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
										viewport={{ once: true, amount: 0.2 }}
										transition={prefersReducedMotion ? undefined : { duration: 0.55, delay: index * 0.08, ease: "easeOut" }}
									>
										<motion.div
											className="group landing-panel landing-shell relative h-full overflow-hidden p-6"
											whileHover={prefersReducedMotion ? undefined : { y: -8, scale: 1.01 }}
											transition={{ duration: 0.25, ease: "easeOut" }}
										>
											<div className="landing-grid-overlay absolute inset-0 opacity-25" aria-hidden />
											<div className="landing-card-glow absolute inset-x-8 top-0 h-24 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
											<div className="relative z-10">
												<motion.div
													className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
													whileHover={prefersReducedMotion ? undefined : { scale: 1.08, rotate: -5 }}
													transition={{ duration: 0.2, ease: "easeOut" }}
												>
													<Icon className="size-5" />
												</motion.div>
												<p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-primary">{pillar.eyebrow}</p>
												<h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{pillar.title}</h3>
												<p className="mt-4 text-sm leading-6 text-muted-foreground">{pillar.description}</p>
											</div>
										</motion.div>
									</motion.div>
								);
							})}
						</div>
					</div>
				</section>

				<section id="workflow" className="px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Workflow"
							title="Four steps from code to live release."
							description="The day-to-day flow stays simple: connect the repo, generate the blueprint, deploy with context, and validate the rollout."
						/>

						<div className="mt-14">
							<WorkflowRail />
						</div>
					</div>
				</section>

				<section id="product" className="hidden border-t border-border/60 px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Product"
							title="See SmartDeploy in action."
							description="Each step of the workflow has a dedicated surface designed for clarity. Explore the key views that developers use every day."
							align="center"
						/>

						<div className="mt-14 space-y-8">
							{screenshotSlots.map((slot, index) => (
								<ScreenshotCard
									key={slot.title}
									slot={slot}
									index={index}
								/>
							))}
						</div>

						<MotionDiv className="mt-16">
							<div className="landing-panel landing-shell overflow-hidden p-6 lg:p-8">
								<div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
									<div>
										<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Ready to ship</p>
										<h3 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
											Deploy with the same precision you put into your code.
										</h3>
										<p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
											SmartDeploy gives developers a clear path from repository to live application with operational visibility at every step.
										</p>
									</div>
									<div className="flex flex-wrap gap-3">
										<Button asChild size="lg">
											<Link href={primaryHref}>
												{primaryCopy}
												<ArrowRight className="size-4" />
											</Link>
										</Button>
										<Button asChild size="lg" variant="outline">
											<Link href="#workflow">
												Review workflow
												<ExternalLink className="size-4" />
											</Link>
										</Button>
									</div>
								</div>
							</div>
						</MotionDiv>
					</div>
				</section>
			</main>

			<footer className="border-t border-border/60 px-6 py-10 lg:px-10">
				<div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
					<div>
						<SmartDeployLogo href="/" className="mb-3" />
						<p className="max-w-xl text-sm text-muted-foreground">
							SmartDeploy gives teams a repo-first path to analyze, deploy, and verify applications from one workspace.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
						<Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
						<Link href="#workflow" className="transition-colors hover:text-foreground">Workflow</Link>
						<Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link>
						<Link href="/changelog" className="transition-colors hover:text-foreground">Changelog</Link>
						<Link href={primaryHref} className="transition-colors hover:text-foreground">Open SmartDeploy</Link>
						<a
							href="https://github.com/anirudh-makuluri/smart-deploy"
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-foreground transition-all hover:border-primary/40 hover:shadow-sm"
						>
							<Github className="size-4" />
							<span>GitHub</span>
						</a>
					</div>
				</div>
			</footer>
		</div>
	);
}
