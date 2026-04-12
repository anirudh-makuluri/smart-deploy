import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

export async function PublicPageFooter() {
	const session = await getServerSession();
	const primaryHref = session ? "/home" : "/auth";

	return (
		<footer className="border-t border-border/60 bg-muted/15 px-6 py-10 lg:px-10">
			<div className="mx-auto flex max-w-7xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
				<div>
					<SmartDeployLogo href="/" className="mb-3" />
					<p className="max-w-md text-sm leading-6 text-muted-foreground">
						Transparent deploys for builders who want the speed of a platform and the honesty of real infra files.
					</p>
				</div>
				<nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground" aria-label="Footer">
					<Link href="/" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Home</Link>
					<Link href="/docs" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Docs</Link>
					<Link href="/#workflow" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">How it works</Link>
					<Link href="/changelog" className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Changelog</Link>
					<Link href={primaryHref} className="rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Open app</Link>
				</nav>
			</div>
		</footer>
	);
}
