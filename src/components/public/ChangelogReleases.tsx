import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import type { ChangelogRecentHighlight, ChangelogRelease } from "@/lib/changelog-releases";

function HighlightDocLink({ href, label }: { href: string; label: string }) {
	return (
		<Link
			href={href}
			className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
		>
			{label}
			<ArrowUpRight className="size-3" aria-hidden />
		</Link>
	);
}

export function ChangelogRecentHighlights({ highlights }: { highlights: ChangelogRecentHighlight[] }) {
	if (highlights.length === 0) return null;

	return (
		<section aria-labelledby="changelog-recent-highlights" className="mt-10">
			<div className="flex items-center gap-2">
				<Sparkles className="size-4 text-primary" aria-hidden />
				<h2 id="changelog-recent-highlights" className="text-sm font-semibold tracking-tight text-foreground">
					Recent highlights
				</h2>
			</div>
			<ul className="mt-4 grid gap-3 sm:grid-cols-2">
				{highlights.map((item) => (
					<li
						key={item.title}
						className="rounded-lg border border-border/80 bg-card/40 p-4 shadow-xs transition-colors hover:border-primary/25"
					>
						<p className="text-sm font-medium text-foreground">{item.title}</p>
						<p className="mt-2 text-[13px] leading-6 text-muted-foreground">{item.description}</p>
						{item.docHref ? (
							<p className="mt-3">
								<HighlightDocLink href={item.docHref} label="Read the guide" />
							</p>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

export function ChangelogReleaseNotes({ releases }: { releases: ChangelogRelease[] }) {
	if (releases.length === 0) return null;

	return (
		<section aria-labelledby="changelog-release-notes" className="mt-14">
			<h2
				id="changelog-release-notes"
				className="border-b border-border pb-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
			>
				Release notes
			</h2>
			<ol className="mt-6 space-y-10">
				{releases.map((release) => (
					<li key={`${release.date}-${release.title}`} className="relative pl-0">
						<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span className="font-mono text-xs font-medium text-primary">{release.label}</span>
							<time dateTime={release.date} className="font-mono text-xs text-muted-foreground">
								{release.date}
							</time>
						</div>
						<h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">{release.title}</h3>
						<p className="mt-2 text-sm leading-7 text-muted-foreground">{release.summary}</p>
						<ul className="mt-4 space-y-4">
							{release.highlights.map((highlight) => (
								<li
									key={`${release.date}-${highlight.title}`}
									className="rounded-md border border-border/60 bg-muted/15 px-4 py-3"
								>
									<p className="text-sm font-medium text-foreground">{highlight.title}</p>
									<p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">{highlight.description}</p>
									{highlight.docHref ? (
										<p className="mt-2">
											<HighlightDocLink href={highlight.docHref} label="Learn more" />
										</p>
									) : null}
								</li>
							))}
						</ul>
					</li>
				))}
			</ol>
		</section>
	);
}