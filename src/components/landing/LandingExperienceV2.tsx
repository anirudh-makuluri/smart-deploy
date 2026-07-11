"use client";

import * as React from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m, useReducedMotion } from "framer-motion";
import { Github, Star } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { InteractiveDeployDemo } from "@/components/landing/InteractiveDeployDemo";
import { LandingBlueprintBackdrop } from "@/components/landing/LandingBlueprintBackdrop";
import { LandingOpenSourceBanner } from "@/components/landing/LandingOpenSourceBanner";
import { LandingFaqSection } from "@/components/landing/LandingFaqSection";
import { PublicPageFooterContent } from "@/components/public/PublicPageFooterContent";
import { Button } from "@/components/ui/button";
import { formatLandingCount } from "@/lib/landing/landingCopy";
import { GITHUB_REPO_URL } from "@/lib/metrics/githubStars";
import type { WorkspacePhase } from "@/components/landing/InteractiveDeployDemo";
import type { LandingPublicStats } from "@/lib/metrics/landingStats";

type LandingExperienceV2Props = {
	isSignedIn: boolean;
	publicStats: LandingPublicStats | null;
	githubStars: number | null;
	initialRepoSlug: string | null;
};

export function LandingExperienceV2({
	isSignedIn,
	publicStats,
	githubStars,
	initialRepoSlug,
}: LandingExperienceV2Props) {
	const primaryHref = isSignedIn ? "/home" : "/auth";
	const primaryCopy = isSignedIn ? "Open Dashboard" : "Deploy a repo";
	const prefersReducedMotion = useReducedMotion();
	const [phase, setPhase] = React.useState<WorkspacePhase>("setup");

	const handleRepoChange = React.useCallback((slug: string) => {
		if (typeof window === "undefined") return;
		const url = new URL(window.location.href);
		url.searchParams.set("repo", slug);
		window.history.replaceState(null, "", url.toString());
	}, []);

	return (
		<LazyMotion features={domAnimation} strict>
			<div className="landing-blueprint landing-bg min-h-svh overflow-x-hidden text-foreground">
				<LandingBlueprintBackdrop phase={phase} />
				<div className="relative z-10 flex min-h-svh flex-col">
					<header className="sticky top-0 z-50 border-b border-border/55 bg-background/70 backdrop-blur-xl">
						<div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
							<div className="min-w-0 shrink">
								<SmartDeployLogo href="/" />
							</div>
							<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
								<Button asChild variant="ghost" size="sm" className="hidden gap-1.5 sm:inline-flex">
									<a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" aria-label="Smart Deploy on GitHub">
										<Github className="size-4" />
										{githubStars !== null && (
											<span className="inline-flex items-center gap-1 tabular-nums">
												<Star className="size-3 fill-current" />
												{formatLandingCount(githubStars)}
											</span>
										)}
									</a>
								</Button>
								<Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
									<Link href="/docs">Docs</Link>
								</Button>
								<Button asChild size="sm" className="sm:h-9 sm:px-4 sm:text-sm">
									<Link href={primaryHref}>
										<span className="sm:hidden">{isSignedIn ? "Dashboard" : "Get started"}</span>
										<span className="hidden sm:inline">{primaryCopy}</span>
									</Link>
								</Button>
							</div>
						</div>
					</header>

					<main className="flex-1">
						<section className="mx-auto flex h-[calc(100svh-69px)] max-w-7xl flex-col gap-2 px-4 py-2 sm:gap-3 sm:px-6 sm:py-3 lg:gap-4 lg:px-10">
							<m.div
								initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
								animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
								transition={{ duration: 0.5, ease: "easeOut" }}
								className="shrink-0"
							>
								<h1 className="text-balance text-[1.35rem] font-semibold leading-[1.08] tracking-[-0.025em] text-foreground sm:text-[1.5rem] lg:text-[1.625rem]">
									Point, preview, deploy.
									<br />
									<span className="text-primary">AWS underneath.</span>
								</h1>
							</m.div>

							<m.div
								initial={prefersReducedMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
								animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
								transition={{ duration: 0.6, ease: "easeOut", delay: 0.08 }}
								className="flex min-h-0 flex-1 items-start justify-center"
							>
								<div className="landing-demo-scale -translate-y-1 sm:-translate-y-2">
									<InteractiveDeployDemo
										compact
										primaryHref={primaryHref}
										primaryCopy={primaryCopy}
										publicStats={publicStats}
										prefersReducedMotion={prefersReducedMotion}
										phase={phase}
										onPhaseChange={setPhase}
										initialRepoSlug={initialRepoSlug}
										onRepoChange={handleRepoChange}
									/>
								</div>
							</m.div>
						</section>

						<div className="relative">
							<LandingOpenSourceBanner githubStars={githubStars} publicStats={publicStats} />
							<LandingFaqSection />
						</div>
					</main>

					<PublicPageFooterContent primaryHref={primaryHref} />
				</div>
			</div>
		</LazyMotion>
	);
}
