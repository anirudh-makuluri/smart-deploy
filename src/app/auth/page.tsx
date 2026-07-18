import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import config from "@/config";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Auth",
	robots: {
		index: false,
		follow: false,
	},
};

type AuthPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	try {
		session = await auth.api.getSession({ headers: await headers() });
	} catch (error) {
		console.error("Failed to read auth session for /auth page:", error);
	}
	if (session) {
		redirect("/home");
	}

	const params = searchParams ? await searchParams : {};
	const error = typeof params.error === "string" ? params.error : undefined;
	const callbackURL = typeof params.callbackURL === "string" && params.callbackURL.startsWith("/") ? params.callbackURL : "/home";
	if (error && config.WAITING_LIST_ENABLED) {
		redirect("/waiting-list");
	}

	return (
		<div className="landing-bg min-h-svh text-foreground">
			<section className="landing-hero-bg relative flex min-h-svh items-center overflow-hidden px-5 py-8 sm:px-6 lg:px-10 lg:py-12">
				<div className="landing-hero-wave pointer-events-none absolute inset-x-0 top-0 h-112 opacity-55" aria-hidden />
				<div className="landing-grid-overlay pointer-events-none absolute inset-0 opacity-30" aria-hidden />

				<div className="relative z-10 mx-auto grid w-full max-w-6xl items-stretch gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8">
					<div className="landing-panel landing-shell flex flex-col gap-5 p-6 sm:p-8">
						<SmartDeployLogo showText size="md" className="self-start" />
						<div className="space-y-2 mb-10">
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Welcome</p>
							<h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Sign in to Smart Deploy</h1>
							<p className="text-sm leading-6 text-muted-foreground">
								Use your GitHub account to continue to your deploy workspace.
							</p>
						</div>
						<LoginForm callbackURL={callbackURL} />
					</div>

					<div className="landing-panel landing-shell flex flex-col justify-center gap-6 p-6 sm:p-8 md:p-10">
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Why Smart Deploy</p>
							<h2 className="max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
								Ship faster with full deployment clarity.
							</h2>
							<p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
								From scan to deploy, every step stays visible so your team can move quickly without guessing what happened in the pipeline.
							</p>
						</div>

						<ul className="grid gap-3 sm:grid-cols-3">
							<li className="rounded-xl border border-border/60 bg-background/70 p-4">
								<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Step 1</p>
								<p className="mt-1 text-sm font-medium text-foreground">Connect your repo</p>
							</li>
							<li className="rounded-xl border border-border/60 bg-background/70 p-4">
								<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Step 2</p>
								<p className="mt-1 text-sm font-medium text-foreground">Review blueprint output</p>
							</li>
							<li className="rounded-xl border border-border/60 bg-background/70 p-4">
								<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Step 3</p>
								<p className="mt-1 text-sm font-medium text-foreground">Deploy with logs and history</p>
							</li>
						</ul>
					</div>
				</div>
			</section>
		</div>
	);
}
