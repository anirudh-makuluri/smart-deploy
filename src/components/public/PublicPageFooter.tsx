import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";

export async function PublicPageFooter() {
	const session = await getServerSession();
	const primaryHref = session ? "/home" : "/auth";

	return (
		<footer className="border-t border-border/60 px-6 py-10 lg:px-10">
			<div className="mx-auto flex max-w-7xl flex-col gap-5 md:flex-row md:items-center md:justify-between">
				<div>
					<SmartDeployLogo href="/" className="mb-3" />
					<p className="max-w-xl text-sm text-muted-foreground">
						SmartDeploy gives teams a repo-first path to analyze, deploy, and verify applications from one workspace.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
					<Link href="#capabilities" className="transition-colors hover:text-foreground">Capabilities</Link>
					<Link href="#workflow" className="transition-colors hover:text-foreground">Workflow</Link>
					<Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link>
					<Link href="/changelog" className="transition-colors hover:text-foreground">Changelog</Link>
					<Link href={primaryHref} className="transition-colors hover:text-foreground">Open SmartDeploy</Link>
				</div>
			</div>
		</footer>
	);
}
