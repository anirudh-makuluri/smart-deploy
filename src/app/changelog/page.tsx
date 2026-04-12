import type { Metadata } from "next";
import { ChangelogFromGit } from "@/components/public/ChangelogFromGit";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { PublicSiteHeader } from "@/components/public/PublicSiteHeader";
import { getChangelogCommits, getGithubRepoSlug } from "@/lib/changelog-from-git";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Recent commits from a checked-in git log snapshot (src/data/changelog-commits.json).",
};

export default function ChangelogPage() {
	const commits = getChangelogCommits();
	const repo = getGithubRepoSlug();

	return (
		<PublicPageScroll>
			<div className="min-h-0 bg-background text-foreground">
				<PublicSiteHeader active="changelog" />

				<main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
					<p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Changelog</p>
					<h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Commit history</h1>

					<div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground">
						<p>
							Shows a <strong className="font-medium text-foreground">checked-in snapshot</strong> of{" "}
							<code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">git log</code>{" "}
							at{" "}
							<code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[11px] text-foreground">
								src/data/changelog-commits.json
							</code>
							. Production images do not include <code className="font-mono text-xs">.git</code>, so commits are not read at
							runtime from git. No curated marketing layer on top of the subjects below.
						</p>
						<p>
							After meaningful work, regenerate from a dev clone:{" "}
							<code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">npm run changelog:snapshot</code>{" "}
							then commit the updated JSON.
						</p>
						<p className="font-mono text-xs text-foreground/90">
							Repository: <span className="text-foreground">{repo}</span>
							{commits.length > 0 ? (
								<span className="text-muted-foreground">
									{" "}
									· {commits.length} commits below (newest first)
								</span>
							) : null}
						</p>
					</div>

					<blockquote className="mt-8 border-l-2 border-primary/35 bg-muted/15 py-3 pl-4 pr-3 text-sm leading-6 text-muted-foreground">
						<p className="font-medium text-foreground">Same idea as the rest of the product</p>
						<p className="mt-2">
							Docs render repo markdown as-is; this page surfaces commit metadata from a repo-native snapshot, not a
							rewritten release feed. Blueprint and deploy views apply the same rule to infrastructure and execution state:
							show the artifact, do not replace it with a second narrative.
						</p>
					</blockquote>

					<ChangelogFromGit commits={commits} />
				</main>
			</div>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
