"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, GitBranch } from "lucide-react";
import Link from "next/link";

import { authClient } from "@/lib/auth-client";

type GithubInstallationStatus = {
	installed: boolean;
};

async function fetchGithubInstallationStatus(): Promise<GithubInstallationStatus> {
	const response = await fetch("/api/github/installations/status");
	if (!response.ok) {
		throw new Error("Could not check GitHub App installation.");
	}
	const payload: unknown = await response.json();
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error("Invalid GitHub App installation response.");
	}
	const installed = (payload as { installed?: unknown }).installed;
	if (typeof installed !== "boolean") {
		throw new Error("Invalid GitHub App installation response.");
	}
	return { installed };
}

export default function GithubAppSetupBanner() {
	const { data: session, isPending } = authClient.useSession();
	const userId = session?.user?.id;
	const installationStatus = useQuery({
		queryKey: ["github-app-installation", userId],
		queryFn: fetchGithubInstallationStatus,
		enabled: !isPending && Boolean(userId),
		staleTime: 60_000,
		retry: false,
	});

	if (installationStatus.data?.installed !== false) return null;

	return (
		<aside className="w-full border-b border-primary/25 bg-primary/[0.07]" aria-label="Set up GitHub auto-deploy">
			<div className="mx-auto flex max-w-400 items-center gap-3 px-4 py-2.5 sm:px-6">
				<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/12 text-primary">
					<GitBranch className="size-4" aria-hidden />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-foreground">Enable GitHub auto-deploy</p>
					<p className="hidden text-xs text-muted-foreground sm:block">
						Install SmartDeploy on the repositories that should deploy when you push.
					</p>
				</div>
				<Link
					href="/api/github/install"
					className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/12 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<span className="hidden sm:inline">Choose repositories</span>
					<span className="sm:hidden">Set up</span>
					<ArrowUpRight className="size-3.5" aria-hidden />
				</Link>
			</div>
		</aside>
	);
}
