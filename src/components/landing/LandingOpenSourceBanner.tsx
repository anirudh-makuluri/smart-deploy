"use client";

import { m } from "framer-motion";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingStatCounter } from "@/components/landing/LandingStatCounter";
import { GITHUB_REPO_URL } from "@/lib/metrics/githubStars";
import type { LandingPublicStats } from "@/lib/metrics/landingStats";
import { formatLandingCount } from "@/lib/landing/landingCopy";
import { useInView } from "@/lib/landing/useInView";

type LandingOpenSourceBannerProps = {
	githubStars: number | null;
	publicStats: LandingPublicStats | null;
};

export function LandingOpenSourceBanner({ githubStars, publicStats }: LandingOpenSourceBannerProps) {
	const [ref, inView] = useInView<HTMLDivElement>();
	const hasStats = Boolean(
		publicStats && (publicStats.totalAnalyses > 0 || publicStats.totalDeployments > 0)
	);

	return (
		<section id="stats" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-10 sm:px-6">
			{hasStats && publicStats && (
				<div className="mb-10 grid gap-4 sm:grid-cols-3">
					<LandingStatCounter value={publicStats.totalAnalyses} label="Smart analyses run" prefix="" suffix="" />
					<LandingStatCounter value={publicStats.totalDeployments} label="Deployments shipped" prefix="" suffix="" />
					<LandingStatCounter value={publicStats.totalArtifacts} label="Build artifacts generated" prefix="" suffix="" />
				</div>
			)}

			<m.div
				ref={ref}
				initial={{ opacity: 0, y: 24 }}
				animate={inView ? { opacity: 1, y: 0 } : undefined}
				transition={{ duration: 0.5, ease: "easeOut" }}
				className="bp-frame landing-panel relative overflow-hidden rounded-lg p-8 text-center sm:p-12"
			>
				<div className="relative z-10 mx-auto max-w-2xl">
					<p className="bp-label inline-block">Apache 2.0 · Open source</p>
					<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
						Read the code. Fork it. Self-host it.
					</h2>
					<p className="mt-3 text-base leading-7 text-muted-foreground">
						Smart Deploy is fully open source. Inspect exactly how your deploys run — no black box, all the way down.
					</p>
					<div className="mt-7 flex justify-center">
						<Button asChild size="lg" className="gap-2">
							<a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
								<Star className="size-4" />
								Star on GitHub
								{githubStars !== null && (
									<span className="ml-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-xs font-semibold tabular-nums">
										{formatLandingCount(githubStars)}
									</span>
								)}
							</a>
						</Button>
					</div>
				</div>
			</m.div>
		</section>
	);
}
