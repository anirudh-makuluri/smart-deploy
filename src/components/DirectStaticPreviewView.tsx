"use client";

import * as React from "react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { BadgeCheck, FolderGit2, Globe, Package, Rocket, ScrollText, TerminalSquare } from "lucide-react";

type DirectStaticPreviewViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
};

function displayFramework(scanResults: SDArtifactsResponse | null) {
	if (!scanResults?.serviceType) return "Static app";
	return scanResults.serviceType.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function commandLine(commands: string[] | undefined) {
	return commands && commands.length > 0 ? commands.join(" && ") : "No commands configured";
}

function envVarCount(envVars: string | null | undefined) {
	if (!envVars?.trim()) return 0;
	return envVars
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean).length;
}

export default function DirectStaticPreviewView({
	deployment,
	scanResults,
}: DirectStaticPreviewViewProps) {
	const steps = [
		{
			id: "source",
			title: "Resolve source",
			description: `Clone ${deployment.branch || "main"} and enter ${scanResults?.workdir || "."}.`,
			icon: FolderGit2,
		},
		{
			id: "install",
			title: "Install dependencies",
			description: `Run ${(scanResults?.package_manager || "npm").toUpperCase()} install inside the service root.`,
			icon: Package,
		},
		{
			id: "build",
			title: "Build static assets",
			description: "Generate the publishable output from the configured build command.",
			icon: TerminalSquare,
		},
		{
			id: "publish",
			title: "Publish with nginx",
			description: `Copy ${scanResults?.output_dir || "dist"} into the web root and serve it behind nginx.`,
			icon: Rocket,
		},
	];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-6">
			<section className="rounded-[28px] border border-white/10 bg-card/95 p-7 shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
				<div className="flex flex-wrap items-start justify-between gap-6">
					<div className="max-w-2xl">
						<p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/70">Deployment Preview</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
							Static deployment will skip containers and publish built assets directly.
						</h2>
						<p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
							This preview reflects the exact direct-static pipeline we intend to run: install, build, copy the output directory,
							then serve it with the materialized nginx configuration.
						</p>
					</div>
					<div className="grid min-w-[260px] gap-3 sm:grid-cols-2">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Service type</p>
							<p className="mt-2 text-sm font-semibold text-foreground">{displayFramework(scanResults)}</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Package manager</p>
							<p className="mt-2 text-sm font-semibold text-foreground">{(scanResults?.package_manager || "npm").toUpperCase()}</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Output directory</p>
							<p className="mt-2 font-mono text-sm font-semibold text-foreground">{scanResults?.output_dir || "dist"}</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Env vars</p>
							<p className="mt-2 text-sm font-semibold text-foreground">{envVarCount(deployment.envVars)} configured</p>
						</div>
					</div>
				</div>
			</section>

			<section className="grid gap-4 lg:grid-cols-4">
				{steps.map((step, index) => {
					const Icon = step.icon;
					return (
						<div key={step.id} className="rounded-[24px] border border-white/10 bg-card/90 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.14)]">
							<div className="flex items-center justify-between">
								<div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
									<Icon className="size-5" />
								</div>
								<span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
									Step {index + 1}
								</span>
							</div>
							<h3 className="mt-5 text-lg font-semibold text-foreground">{step.title}</h3>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
						</div>
					);
				})}
			</section>

			<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="rounded-[24px] border border-white/10 bg-card/90 p-6">
					<div className="flex items-center gap-3">
						<div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
							<BadgeCheck className="size-5" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-foreground">Configured commands</h3>
							<p className="text-sm text-muted-foreground">These are the commands that the direct-static path will execute.</p>
						</div>
					</div>
					<div className="mt-5 space-y-4">
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Install</p>
							<div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 font-mono text-sm text-foreground">
								{commandLine(scanResults?.install)}
							</div>
						</div>
						<div>
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Build</p>
							<div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 font-mono text-sm text-foreground">
								{commandLine(scanResults?.build)}
							</div>
						</div>
					</div>
				</div>

				<div className="rounded-[24px] border border-white/10 bg-card/90 p-6">
					<div className="flex items-center gap-3">
						<div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
							<ScrollText className="size-5" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-foreground">Serving strategy</h3>
							<p className="text-sm text-muted-foreground">The deployment will materialize this nginx behavior on the host.</p>
						</div>
					</div>
					<div className="mt-5 space-y-4">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<div className="flex items-center gap-2 text-sm font-semibold text-foreground">
								<Globe className="size-4 text-primary" />
								{scanResults?.spa_fallback ? "SPA fallback enabled" : "Static file serving only"}
							</div>
							<p className="mt-2 text-sm leading-6 text-muted-foreground">
								{scanResults?.spa_fallback
									? "Unknown routes will resolve to index.html so client-side routing keeps working."
									: "Only physical files will be served. Missing routes will return a normal 404."}
							</p>
						</div>
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Nginx present</p>
							<p className="mt-2 text-sm text-muted-foreground">
								{scanResults?.nginx_conf?.trim()
									? "Yes. The config is already materialized in Configure and can be edited per deployment."
									: "No nginx config found yet."}
							</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
