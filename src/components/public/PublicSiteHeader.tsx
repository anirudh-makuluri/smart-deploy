import Link from "next/link";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

const navLink =
	"text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm";
const navLinkActive = "text-sm font-medium text-foreground";

export type PublicSiteHeaderActive = "docs" | "changelog";

type PublicSiteHeaderProps = {
	active: PublicSiteHeaderActive;
};

export function PublicSiteHeader({ active }: PublicSiteHeaderProps) {
	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
			<div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
				<SmartDeployLogo href="/" />
				<nav className="flex shrink-0 items-center gap-4" aria-label="Site">
					<Link href="/" className={navLink}>
						Home
					</Link>
					<Link href="/docs" className={active === "docs" ? navLinkActive : navLink}>
						Docs
					</Link>
					<Link href="/changelog" className={active === "changelog" ? navLinkActive : navLink}>
						Changelog
					</Link>
				</nav>
			</div>
		</header>
	);
}
