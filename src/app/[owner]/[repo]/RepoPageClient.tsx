"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import DeployWorkspace from "@/components/DeployWorkspace";
import Header from "@/components/Header";
import RepoServicesList from "@/components/RepoServicesList";
import { useRepoPageClient } from "@/app/[owner]/[repo]/useRepoPageClient";

type RepoPageClientProps = {
	owner: string;
	repoName: string;
};

export default function RepoPageClient({ owner, repoName }: RepoPageClientProps) {
	const {
		repo,
		repoUrl,
		activeService,
		mobileWorkspaceNavOpen,
		setMobileWorkspaceNavOpen,
		services,
		loading,
		repoError,
		retryRepo,
		error,
		repoDeployments,
		openWorkspaceForService,
		catalogActions,
	} = useRepoPageClient(owner, repoName);
	const repoUnavailable = !loading && !repo;

	return (
		<div className={`dot-grid-bg flex flex-col text-foreground ${activeService ? "h-svh overflow-hidden" : "min-h-svh"}`}>
			{loading && !repo && (
				<div className="flex-1 flex items-center justify-center">
					<div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 text-muted-foreground">
						<Loader2 className="size-5 animate-spin" />
						<span>Loading repository...</span>
					</div>
				</div>
			)}
			{repoUnavailable && (
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center space-y-4">
						<h1 className="text-3xl font-bold">Unable to load repository</h1>
						<p className="text-muted-foreground">
							Could not load <span className="font-mono font-semibold">{owner}/{repoName}</span>.
						</p>
						<p role="alert" className="text-muted-foreground">
							{!repoError || repoError.message === "Unexpected error."
								? "Something went wrong while loading this repository. Please try again."
								: repoError.message}
						</p>
						<button
							type="button"
							onClick={() => void retryRepo()}
							className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
						>
							Try again
						</button>
						<Link
							href="/"
							className="inline-block mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
						>
							Go Back Home
						</Link>
					</div>
				</div>
			)}
			{repo && (
				<>
					<Header
						workspaceNav={
							activeService
								? { onOpenMobileSidebar: () => setMobileWorkspaceNavOpen(true) }
								: undefined
						}
					/>

					<main className={activeService ? "flex-1 min-h-0 overflow-hidden" : "flex-1 min-h-0 overflow-auto"}>
						{activeService ? (
							<DeployWorkspace
								key={`${repo.full_name}:${activeService.name}`}
								mobileNavOpen={mobileWorkspaceNavOpen && Boolean(activeService)}
								onMobileNavOpenChange={setMobileWorkspaceNavOpen}
							/>
						) : (
							<RepoServicesList
								owner={owner}
								repoName={repoName}
								repoUrl={repoUrl}
								services={services}
								loading={loading}
								error={error}
								repoDeployments={repoDeployments}
								resolvedRepo={repo}
								openWorkspaceForService={openWorkspaceForService}
								catalogActions={catalogActions}
							/>
						)}
					</main>
				</>
			)}
		</div>
	);
}
