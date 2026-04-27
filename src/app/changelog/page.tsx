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
	const commits = getChangelogCommits({ limit: 120 });
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
							<code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">git log</code>.
						</p>
						<p className="font-mono text-xs text-foreground/90">
							Repository: <span className="text-foreground">{repo}</span>
							{commits.length > 0 ? (
								<span className="text-muted-foreground"> - {commits.length} commits below (newest first)</span>
							) : null}
						</p>
						<p className="text-xs">
							Need older history?{" "}
							<a
								className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
								href={`https://github.com/${repo}/commits/main`}
								rel="noreferrer"
								target="_blank"
							>
								View full commit history on GitHub
							</a>
							.
						</p>
					</div>

					<ChangelogFromGit commits={commits} />
				</main>
			</div>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
