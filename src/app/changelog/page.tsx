import type { Metadata } from "next";
import { PublicPageFooter } from "@/components/public/PublicPageFooter";
import { PublicPageScroll } from "@/components/public/PublicPageScroll";
import { PublicSiteHeader } from "@/components/public/PublicSiteHeader";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-entries";

export const metadata: Metadata = {
	title: "Changelog | Smart Deploy",
	description: "Recent updates to the public site, documentation, and related services.",
};

export default function ChangelogPage() {
	return (
		<PublicPageScroll>
			<div className="min-h-0 bg-background text-foreground">
				<PublicSiteHeader active="changelog" />

				<main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
					<h1 className="text-2xl font-semibold tracking-tight text-foreground">Changelog</h1>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
						Last ten updates we care to highlight here. For the full record, use the repository commit history.
					</p>

					<ul className="mt-10 space-y-0 divide-y divide-border border-y border-border">
						{CHANGELOG_ENTRIES.map((entry) => (
							<li key={`${entry.date}-${entry.summary}`} className="py-5 first:pt-0">
								<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.date}</p>
								<p className="mt-2 text-sm leading-7 text-foreground">{entry.summary}</p>
							</li>
						))}
					</ul>
				</main>
			</div>
			<PublicPageFooter />
		</PublicPageScroll>
	);
}
