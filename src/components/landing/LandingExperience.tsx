"use client";

import type React from "react";
import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
	ArrowRight,
	CheckCircle2,
	ExternalLink,
	Github,
	ImageOff,
	Layers3,
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

const productPillars: ProductPillar[] = [
	{
		eyebrow: "GitHub Intake",
		title: "Import a repo and let SmartDeploy map the codebase.",
		description:
			"SmartDeploy detects services, runtimes, and branch status from your repository so you start with a deployment-ready workspace instead of a blank checklist.",
		icon: Github,
	},
	{
		eyebrow: "Smart Analysis",
		title: "Generate a deployment blueprint before you launch.",
		description:
			"Runtime checks, service dependencies, and deployment constraints are surfaced upfront so engineers make decisions with real technical context.",
		icon: ScanSearch,
	},
	{
		eyebrow: "Deploy and Verify",
		title: "Ship with logs, rollout state, and preview in one view.",
		description:
			"Visibility doesn't end after pressing deploy. Logs, status, and the live application stay connected to the release action.",
		icon: SquareTerminal,
	},
];

const workflowSteps: WorkflowStep[] = [
	{
		id: "01",
		title: "Connect a repository",
		description: "Import a GitHub repo, detect services, and establish the deployment surface in seconds.",
		icon: Github,
	},
	{
		id: "02",
		title: "Generate the blueprint",
		description: "Run Smart Analysis to inspect runtime needs, service layout, and deployment constraints.",
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
			<div className="flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed border-border/70 bg-muted/30 p-8 sm:min-h-[360px]">
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
		<img
			src={src}
			alt={alt}
			onError={() => setFailed(true)}
			className="w-full rounded-[20px] border border-border/40 object-cover"
			loading="lazy"
		/>
	);
}

function HeroPreview() {
	return (
		<MotionDiv className="relative" y={12}>
			<div className="landing-halo absolute -right-8 -top-10 h-40 w-40 rounded-full opacity-80 blur-3xl" aria-hidden />
			<div className="landing-panel landing-shell relative overflow-hidden p-3 sm:p-4">
				<div className="landing-grid-overlay absolute inset-0 opacity-40" aria-hidden />
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
					<div className="mt-3">
						<ScreenshotImage
							src="/screenshots/dashboard.png"
							alt="SmartDeploy dashboard overview"
						/>
					</div>
				</div>
			</div>
		</MotionDiv>
	);
}

function WorkflowRail() {
	return (
		<div className="grid gap-4 lg:grid-cols-4">
			{workflowSteps.map((step, index) => {
				const Icon = step.icon;

				return (
					<MotionDiv key={step.id} delay={index * 0.06}>
						<div className="landing-panel landing-shell relative h-full overflow-hidden p-5">
							<div className="landing-grid-overlay absolute inset-0 opacity-25" aria-hidden />
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
					</MotionDiv>
				);
			})}
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
	return (
		<MotionDiv delay={index * 0.08}>
			<div className="landing-panel landing-shell overflow-hidden p-5 lg:p-6">
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
					<div className="mt-3">
						<ScreenshotImage src={slot.imageSrc} alt={slot.imageAlt} />
					</div>
				</div>
				<h3 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">{slot.title}</h3>
				<p className="mt-3 text-base leading-7 text-muted-foreground">{slot.description}</p>
			</div>
		</MotionDiv>
	);
}

export function LandingExperience({ isSignedIn }: LandingExperienceProps) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Start Deploying";

	return (
		<div className="landing-bg min-h-svh text-foreground">
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-4">
					<SmartDeployLogo href="/" />
					<nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
						<Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
						<Link href="#workflow" className="transition-colors hover:text-foreground">Workflow</Link>
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
				<section className="landing-hero-bg relative overflow-hidden px-6 pb-20 pt-16 lg:px-10 lg:pb-28 lg:pt-20">
					<div className="landing-grid-overlay absolute inset-0 opacity-45" aria-hidden />
					<div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
						<MotionDiv className="relative z-10">
							<div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
								<Layers3 className="size-3.5" />
								Smart deployment platform
							</div>
							<h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
								Turn a GitHub repo into a deployable application.
							</h1>
							<p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
								Connect a repo, let Smart Analysis map the runtime and service layout, then deploy with logs, status, and preview still in view.
							</p>
							<div className="mt-8 flex flex-wrap gap-3">
								<Button asChild size="lg" className="gap-2">
									<Link href={primaryHref}>
										{primaryCopy}
										<ArrowRight className="size-4" />
									</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="#capabilities">Learn more</Link>
								</Button>
							</div>
						</MotionDiv>

						<div className="relative z-10">
							<HeroPreview />
						</div>
					</div>
				</section>

				<section id="capabilities" className="border-y border-border/60 bg-muted/20 px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Capabilities"
							title="Repository in, deployable application out."
							description="SmartDeploy handles the full path from source code to production: import the repository, understand the application, deploy with context, and verify the live result."
							align="center"
						/>

						<div className="mt-14 grid gap-5 lg:grid-cols-3">
							{productPillars.map((pillar, index) => {
								const Icon = pillar.icon;

								return (
									<MotionDiv key={pillar.title} delay={index * 0.08}>
										<div className="landing-panel landing-shell relative h-full overflow-hidden p-6">
											<div className="landing-grid-overlay absolute inset-0 opacity-25" aria-hidden />
											<div className="relative z-10">
												<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
													<Icon className="size-5" />
												</div>
												<p className="mt-5 text-xs font-semibold uppercase tracking-[0.24em] text-primary">{pillar.eyebrow}</p>
												<h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{pillar.title}</h3>
												<p className="mt-4 text-sm leading-6 text-muted-foreground">{pillar.description}</p>
											</div>
										</div>
									</MotionDiv>
								);
							})}
						</div>
					</div>
				</section>

				<section id="workflow" className="px-6 py-20 lg:px-10">
					<div className="mx-auto max-w-7xl">
						<SectionIntro
							eyebrow="Workflow"
							title="Four steps from source code to production."
							description="A concrete, developer-facing release flow that covers import, analysis, deploy, and validation in one workspace."
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
							SmartDeploy gives developers a repo-first path to analyze, deploy, and verify applications from one workspace.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
						<Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
						<Link href="#workflow" className="transition-colors hover:text-foreground">Workflow</Link>
						<Link href={primaryHref} className="transition-colors hover:text-foreground">Open SmartDeploy</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
