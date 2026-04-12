import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { Github } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

const linkClass =
	"rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

const navLinkClass = `text-sm text-muted-foreground ${linkClass}`;
const primaryLinkClass = `rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`;

const githubPillClass =
	"inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-foreground transition-all hover:border-primary/40 hover:shadow-sm";

const GITHUB_REPOS = [
	{
		href: "https://github.com/anirudh-makuluri/smart-deploy",
		label: "smart-deploy",
		ariaLabel: "Smart Deploy app repository on GitHub",
	},
	{
		href: "https://github.com/anirudh-makuluri/sd-artifacts",
		label: "sd-artifacts",
		ariaLabel: "sd-artifacts backend repository on GitHub",
	},
] as const;

type PublicPageFooterContentProps = {
	primaryHref: string;
};

/**
 * Shared footer for landing, docs, and changelog. Section links use `/#…` so they work from any route.
 */
export function PublicPageFooterContent({ primaryHref }: PublicPageFooterContentProps) {
	return (
		<footer className="border-t border-border/60 bg-muted/15 px-6 py-10 lg:px-10">
			<div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
				<div>
					<SmartDeployLogo href="/" className="mb-3" />
					<p className="max-w-xl text-sm leading-6 text-muted-foreground">
						Smart Deploy is a transparent deployment platform for solo developers who want to ship quickly without hiding Docker, Compose, Nginx, or the deploy path.
					</p>
				</div>
				<nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground" aria-label="Footer">
					<Link href="/" className={navLinkClass}>
						Home
					</Link>
					<Link href="/#start-your-way" className={navLinkClass}>
						Your way
					</Link>
					<Link href="/#problem-solution" className={navLinkClass}>
						Problem and solution
					</Link>
					<Link href="/#comparison" className={navLinkClass}>
						Comparison
					</Link>
					<Link href="/#workflow" className={navLinkClass}>
						How it works
					</Link>
					<Link href="/docs" className={navLinkClass}>
						Docs
					</Link>
					<Link href="/changelog" className={navLinkClass}>
						Changelog
					</Link>
					<Link href={primaryHref} className={primaryLinkClass}>
						Open app
					</Link>
					<span className="inline-flex flex-wrap items-center gap-2">
						{GITHUB_REPOS.map((repo) => (
							<a
								key={repo.href}
								href={repo.href}
								target="_blank"
								rel="noreferrer"
								className={githubPillClass}
								aria-label={repo.ariaLabel}
							>
								<Github className="size-4 shrink-0" aria-hidden />
								<span className="font-mono text-xs">{repo.label}</span>
							</a>
						))}
					</span>
				</nav>
			</div>
		</footer>
	);
}

export async function PublicPageFooter() {
	const session = await getServerSession();
	const primaryHref = session ? "/home" : "/auth";

	return <PublicPageFooterContent primaryHref={primaryHref} />;
}
