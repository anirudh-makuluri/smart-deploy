import Link from "next/link";
import type { ReactNode } from "react";
import { PublicSiteHeader } from "@/components/public/PublicSiteHeader";
import type { DocGuideEntry } from "@/lib/public-docs";

type DocsSimpleLayoutProps = {
	guideLinks: DocGuideEntry[];
	/** `null` when viewing README; guide slug when viewing a `docs/*.md` page. */
	activeSlug: string | null;
	/** Repository-relative path shown above rendered markdown. */
	contentSourcePath: string;
	children: ReactNode;
};

export function DocsSimpleLayout({ guideLinks, activeSlug, contentSourcePath, children }: DocsSimpleLayoutProps) {
	return (
		<div className="min-h-0 bg-background text-foreground">
			<PublicSiteHeader active="docs" />

			<div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
				<p className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Documentation</p>
				<h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Repository docs</h2>

				<div className="mt-6 space-y-4 text-sm leading-7 text-muted-foreground">
					<p>
						This route renders the{" "}
						<strong className="font-medium text-foreground">repository README</strong> and{" "}
						<strong className="font-medium text-foreground">markdown under</strong>{" "}
						<code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">docs/</code>{" "}.
					</p>
					<p className="font-mono text-xs text-foreground/90">
						Source: <span className="text-foreground">{contentSourcePath}</span>
						{activeSlug === null ? (
							<>
								{" "}
								+ <code className="text-foreground">docs/*.md</code> index below
							</>
						) : null}
					</p>
				</div>

				<nav aria-label="Documentation index" className="mt-10 border-b border-border pb-8">
					<p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Index</p>
					<ul className="mt-4 space-y-2.5 text-sm">
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
							{activeSlug === null ? (
								<span className="ml-2 font-mono text-[11px] text-muted-foreground">current</span>
							) : null}
						</li>
						{guideLinks.length > 0 && (
							<li className="pt-3">
								<p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
									docs/
								</p>
								<ul className="mt-2.5 space-y-1.5 border-l border-border/80 pl-3">
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
												<span className="font-mono text-xs">{g.filename}</span>
												<span className="ml-2 text-muted-foreground/80">· {g.title}</span>
											</Link>
											{activeSlug === g.slug ? (
												<span className="ml-2 font-mono text-[11px] text-muted-foreground">current</span>
											) : null}
										</li>
									))}
								</ul>
							</li>
						)}
					</ul>
				</nav>

				<section className="mt-10 border-t border-border pt-10" aria-labelledby="docs-rendered-heading">
					<h2 id="docs-rendered-heading" className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Rendered document
					</h2>
					<p className="mt-2 font-mono text-sm text-foreground">{contentSourcePath}</p>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Parsed server-side (markdown to HTML in the app). Same bytes you get from the checkout.
					</p>
					<div className="mt-8 max-w-none">{children}</div>
				</section>
			</div>
		</div>
	);
}
