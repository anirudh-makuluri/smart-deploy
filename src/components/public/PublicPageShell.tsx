import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, FileText, Layers3, Radar, Sparkles } from "lucide-react";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Stat = {
	value: string;
	label: string;
};

type PublicPageShellProps = {
	badge: string;
	title: string;
	description: string;
	eyebrow?: string;
	stats?: Stat[];
	showMilestonesButton?: boolean;
	showDocsButton?: boolean;
	asideTitle: string;
	asideDescription: string;
	asideLinks?: {
		href: string;
		label: string;
	}[];
	children: ReactNode;
};

const navLinks = [
	{ href: "/", label: "Home" },
	{ href: "/docs", label: "Docs" },
	{ href: "/changelog", label: "Changelog" },
];

export function PublicPageShell({
	badge,
	title,
	description,
	eyebrow = "SmartDeploy",
	stats = [],
	showMilestonesButton = true,
	showDocsButton = true,
	asideTitle,
	asideDescription,
	asideLinks = [],
	children,
}: PublicPageShellProps) {
	return (
		<div className="landing-bg min-h-svh overflow-x-hidden text-foreground">
			<div className="landing-hero-wave pointer-events-none absolute inset-x-0 top-0 h-96 opacity-60" aria-hidden />
			<header className="sticky top-0 z-50 border-b border-border/60 bg-background/82 backdrop-blur-xl">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 lg:px-8">
					<SmartDeployLogo href="/" />
					<nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
						{navLinks.map((link) => (
							<Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
								{link.label}
							</Link>
						))}
					</nav>
					<div className="flex shrink-0 items-center gap-2">
						{showMilestonesButton && (
							<Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
								<Link href="/changelog">Recent Milestones</Link>
							</Button>
						)}
						{showDocsButton && (
							<Button asChild size="sm" className="shadow-[0_18px_40px_-20px_rgba(59,130,246,0.85)]">
								<Link href="/docs">Read the Docs</Link>
							</Button>
						)}
					</div>
				</div>
			</header>

			<main className="relative px-4 pb-20 pt-10 lg:px-8 lg:pb-28 lg:pt-14">
				<div className="mx-auto max-w-7xl">
					<section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
						<div className="landing-panel landing-shell overflow-hidden p-8 sm:p-10">
							<div className="landing-grid-overlay absolute inset-0 opacity-30" aria-hidden />
							<div className="relative z-10">
								<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">{eyebrow}</p>
								<div className="mt-4 flex flex-wrap items-center gap-3">
									<Badge className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
										<Sparkles className="size-3.5" />
										{badge}
									</Badge>
								</div>
								<h1 className="mt-6 max-w-4xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-[3.2rem] lg:leading-[0.96]">
									{title}
								</h1>
								<p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
									{description}
								</p>

								{stats.length > 0 && (
									<div className="mt-8 grid gap-3 sm:grid-cols-3">
										{stats.map((stat) => (
											<div key={stat.label} className="rounded-[1.4rem] border border-border/70 bg-background/45 px-4 py-4">
												<p className="text-2xl font-semibold tracking-tight text-foreground">{stat.value}</p>
												<p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
													{stat.label}
												</p>
											</div>
										))}
									</div>
								)}
							</div>
						</div>

						<aside className="landing-panel landing-shell overflow-hidden p-6 sm:p-7">
							<div className="landing-card-glow absolute inset-x-8 top-0 h-24 opacity-80" aria-hidden />
							<div className="relative z-10">
								<div className="flex items-center gap-3 text-primary">
									<div className="rounded-2xl bg-primary/10 p-3">
										<Radar className="size-5" />
									</div>
									<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Overview</p>
								</div>
								<h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">{asideTitle}</h2>
								<p className="mt-3 text-sm leading-6 text-muted-foreground">{asideDescription}</p>
								<div className="mt-6 space-y-3">
									{asideLinks.map((link) => (
										<Link
											key={link.href}
											href={link.href}
											className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/40 px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/45 hover:bg-primary/5"
										>
											<span>{link.label}</span>
											<ArrowRight className="size-4 text-primary" />
										</Link>
									))}
								</div>
							</div>
						</aside>
					</section>

					<section className="mt-8 grid gap-6 lg:grid-cols-[0.72fr_1.28fr]">
						<div className="space-y-6">
							<div className="landing-panel landing-shell overflow-hidden p-6">
								<div className="flex items-center gap-3">
									<div className="rounded-2xl bg-primary/10 p-3 text-primary">
										<FileText className="size-5" />
									</div>
									<div>
										<p className="text-sm font-semibold text-foreground">Docs that get you shipping</p>
										<p className="text-sm text-muted-foreground">Architecture, deploy flow, and product context in one place.</p>
									</div>
								</div>
							</div>
							<div className="landing-panel landing-shell overflow-hidden p-6">
								<div className="flex items-center gap-3">
									<div className="rounded-2xl bg-primary/10 p-3 text-primary">
										<Layers3 className="size-5" />
									</div>
									<div>
										<p className="text-sm font-semibold text-foreground">Built for teams that ship</p>
										<p className="text-sm text-muted-foreground">Content is structured for quick decisions, not long internal writeups.</p>
									</div>
								</div>
							</div>
						</div>

						<div className="space-y-6">{children}</div>
					</section>
				</div>
			</main>
		</div>
	);
}
