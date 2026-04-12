import Link from "next/link";
import type { ReactNode } from "react";
import { PublicSiteHeader } from "@/components/public/PublicSiteHeader";
import type { DocGuideEntry } from "@/lib/public-docs";

type DocsSimpleLayoutProps = {
	guideLinks: DocGuideEntry[];
	/** `null` when viewing README; guide slug when viewing a `docs/*.md` page. */
	activeSlug: string | null;
	children: ReactNode;
};

export function DocsSimpleLayout({ guideLinks, activeSlug, children }: DocsSimpleLayoutProps) {
	return (
		<div className="min-h-0 bg-background text-foreground">
			<PublicSiteHeader active="docs" />

			<div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">Documentation</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					README from the repository root and guides from the <code className="font-mono text-xs">docs/</code> folder.
				</p>

				<nav aria-label="Documentation sections" className="mt-8 border-b border-border pb-8">
					<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this site</p>
					<ul className="mt-3 space-y-2 text-sm">
						<li>
							<Link
								href="/docs"
								className={
									activeSlug === null
										? "font-medium text-foreground"
										: "text-muted-foreground hover:text-foreground"
								}
							>
								README.md
							</Link>
							{activeSlug === null && <span className="ml-2 text-xs text-muted-foreground">(current)</span>}
						</li>
						{guideLinks.length > 0 && (
							<li className="pt-2">
								<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Guides</p>
								<ul className="mt-2 space-y-1.5 border-l border-border pl-3">
									{guideLinks.map((g) => (
										<li key={g.slug}>
											<Link
												href={`/docs/${g.slug}`}
												className={
													activeSlug === g.slug
														? "font-medium text-foreground"
														: "text-muted-foreground hover:text-foreground"
												}
											>
												{g.title}
											</Link>
											{activeSlug === g.slug && (
												<span className="ml-2 text-xs text-muted-foreground">(current)</span>
											)}
										</li>
									))}
								</ul>
							</li>
						)}
					</ul>
				</nav>

				<div className="pt-8">{children}</div>
			</div>
		</div>
	);
}
