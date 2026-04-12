import type { Metadata } from "next";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Updates to the public Smart Deploy marketing site, docs page, and repository documentation.",
};

const stats = [
	{ value: "1", label: "site pass" },
	{ value: "Apr 12, 2026", label: "shipped" },
	{ value: "Marketing + docs", label: "focus" },
];

const releases = [
	{
		date: "April 12, 2026",
		title: "Public site, in-product docs page, and README alignment",
		points: [
			"Rebuilt the landing page into a full marketing story: hero with live-styled preview, problem and solution narrative, comparison table, four-step workflow rail, infrastructure visibility, screenshot strips, and a stronger footer with GitHub.",
			"Added dedicated `/docs` and `/changelog` routes that reuse a shared glass-style shell, overview aside, and footer so the public experience feels like one product surface instead of disconnected templates.",
			"Refreshed `README.md` so the repository intro, workflow summary, screenshot references, and setup sections read cleanly for newcomers landing from the site or GitHub.",
			"Tuned shared chrome: primary-accent CTAs, mobile menu on narrow viewports, and sidebar callouts that describe how the docs are written rather than repeating backend feature lists.",
		],
	},
];

export default async function ChangelogPage() {
	return (
		<PublicPageScroll>
			<PublicPageShell
				eyebrow="Smart Deploy Changelog"
				badge="Website & docs"
				title="What changed on the public site and in the README."
				description="This page is intentionally narrow: it records the work we did on the marketing pages, the public docs surface, and repository documentation. It is not a substitute for git history for application or infrastructure runtime changes."
				stats={stats}
				showMilestonesButton={false}
				asideTitle="How to use this page"
				asideDescription="Skim the dated entry for a high-level picture of the site and docs pass. For deploy engine changes, use commits, tags, and pull requests in the repository."
				asideLinks={[
					{ href: "/docs", label: "Read the documentation" },
					{ href: "/", label: "Back to the landing page" },
				]}
			>
				<div className="landing-panel landing-shell overflow-hidden p-6 sm:p-8">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Release notes</p>
					<h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Latest entry</h2>
					<div className="mt-8 space-y-5">
						{releases.map((release) => (
							<article
								key={`${release.date}-${release.title}`}
								className="rounded-[1.7rem] border border-border/70 bg-background/40 p-5 sm:p-6"
							>
								<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">{release.date}</p>
								<h3 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
									{release.title}
								</h3>
								<ul className="mt-5 space-y-3">
									{release.points.map((point) => (
										<li
											key={point}
											className="rounded-[1.25rem] border border-border/70 bg-background/45 px-4 py-3 text-sm leading-6 text-muted-foreground"
										>
											{point}
										</li>
									))}
								</ul>
							</article>
						))}
					</div>
				</div>
			</PublicPageShell>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
