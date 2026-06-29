import type { Metadata } from "next";
import Link from "next/link";
import { ChangelogFromGit } from "@/components/public/ChangelogFromGit";
import { ChangelogRecentHighlights, ChangelogReleaseNotes } from "@/components/public/ChangelogReleases";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { PublicSiteHeader } from "@/components/public/PublicSiteHeader";
import { getChangelogCommits, getGithubRepoSlug } from "@/lib/changelog-from-git";
import { getChangelogReleases } from "@/lib/changelog-releases";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Release notes, recent highlights, and ship history for Smart Deploy.",
};

export default function ChangelogPage() {
	const commits = getChangelogCommits({ limit: 80 });
	const releases = getChangelogReleases();
	const repo = getGithubRepoSlug();

	return (
		<PublicPageScroll>
			<div className="min-h-0 bg-background text-foreground">
				<PublicSiteHeader active="changelog" />

				<main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
					<p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Changelog</p>
					<h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">What&apos;s new</h1>

					<div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground">
						<p>
							User-facing <strong className="font-medium text-foreground">release notes</strong> for the platform,
							plus a developer commit log synced from{" "}
							<code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">git</code>.
						</p>
						<p>
							Deploying an app and stuck? Start with{" "}
							<Link href="/docs/debugging-deployments" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
								debugging deployments
							</Link>{" "}
							or the{" "}
							<Link href="/docs/deployment-agent" className="font-medium text-foreground underline underline-offset-2 hover:text-primary">
								Deployment Agent
							</Link>
							.
						</p>
						{releases.updatedAt ? (
							<p className="font-mono text-xs text-foreground/90">
								Release notes updated <span className="text-foreground">{releases.updatedAt}</span>
							</p>
						) : null}
					</div>

					<ChangelogRecentHighlights highlights={releases.recentHighlights} />
					<ChangelogReleaseNotes releases={releases.releases} />

					<details className="group mt-14 rounded-lg border border-border/80 bg-muted/10 open:bg-muted/5">
						<summary className="cursor-pointer list-none px-4 py-4 marker:content-none sm:px-5">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
										Developer log
									</p>
									<p className="mt-1 text-sm font-medium text-foreground">Commit history</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{repo}
										{commits.length > 0 ? ` · ${commits.length} commits (newest first)` : null}
									</p>
								</div>
								<span className="text-xs font-medium text-muted-foreground group-open:hidden">Show commits</span>
								<span className="hidden text-xs font-medium text-muted-foreground group-open:inline">Hide commits</span>
							</div>
						</summary>
						<div className="border-t border-border/60 px-4 pb-6 pt-2 sm:px-5">
							<p className="text-xs text-muted-foreground">
								<a
									className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
									href={`https://github.com/${repo}/commits/main`}
									rel="noreferrer"
									target="_blank"
								>
									View full history on GitHub
								</a>
								{" · "}
								Regenerate locally with <code className="font-mono text-[11px]">npm run changelog:snapshot</code>
							</p>
							<ChangelogFromGit commits={commits} />
						</div>
					</details>
				</main>
			</div>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}