"use client";

import * as React from "react";
import { Github, AlertTriangle, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { DetectedServiceInfo, DeployConfig, repoType } from "@/app/types";
import { getDeploymentForService } from "@/lib/utils";

export type RepoCatalogActions = {
	busy: boolean;
	onAddService: (rootPath: string, displayName?: string) => Promise<boolean>;
};

type RepoServicesListProps = {
	owner: string;
	repoName: string;
	repoUrl: string;
	services: DetectedServiceInfo[];
	loading: boolean;
	error: string | null;
	repoDeployments: DeployConfig[];
	resolvedRepo: repoType;
	openWorkspaceForService: (svc: DetectedServiceInfo) => void;
	catalogActions?: RepoCatalogActions;
};

export default function RepoServicesList({
	owner,
	repoName,
	repoUrl,
	services,
	loading,
	error,
	repoDeployments,
	resolvedRepo,
	openWorkspaceForService,
	catalogActions,
}: RepoServicesListProps) {
	const [sheet, setSheet] = React.useState<null | "add">(null);
	const [rootPath, setRootPath] = React.useState(".");
	const [displayName, setDisplayName] = React.useState("");

	const busy = catalogActions?.busy ?? false;

	async function submitAdd() {
		if (!catalogActions) return;
		const ok = await catalogActions.onAddService(rootPath.trim() || ".", displayName.trim() || undefined);
		if (!ok) return;
		setSheet(null);
		setRootPath(".");
		setDisplayName("");
	}

	return (
		<div className="flex flex-col h-full p-6">
			<div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="text-xl font-semibold text-foreground">
						{owner} / {repoName}
					</h1>
					<p className="text-sm text-muted-foreground mt-0.5">
						{services.length} service{services.length !== 1 ? "s" : ""}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{catalogActions && !loading && !error && (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="shrink-0"
								disabled={busy}
								onClick={() => setSheet("add")}
							>
								<FolderPlus className="size-4 mr-1.5" />
								Add service
							</Button>
						</>
					)}
				</div>
			</div>

			{loading && (
				<div className="text-muted-foreground py-8 text-center">Loading services…</div>
			)}
			{error && (
				<div className="rounded-xl border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3">
					{error}
				</div>
			)}
			{!loading && !error && services.length === 0 && (
				<div className="rounded-xl border border-dashed border-border bg-card/30 p-8 text-center text-muted-foreground space-y-3">
					<p>No services yet. Add a root directory, or refresh the page to re-run detection.</p>
					{catalogActions && (
						<div className="flex flex-wrap justify-center gap-2">
							<Button type="button" variant="secondary" disabled={busy} onClick={() => setSheet("add")}>
								Add service
							</Button>
						</div>
					)}
				</div>
			)}
			{!loading && !error && services.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					{services.map((svc) => {
						const deployment = getDeploymentForService(
							repoDeployments,
							repoUrl,
							svc.name,
							resolvedRepo.name
						);
						const status = deployment?.status;
						const isOnline = status === "running";
						const isDraft = deployment && status !== "running" && status !== "failed";
						const hasNoDeployment = !deployment;
						const isFailed = status === "failed";
						const liveUrl = deployment?.liveUrl;

						const handleCardClick = () => {
							openWorkspaceForService(svc);
						};

						const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleCardClick();
							}
						};

						const handleLiveUrlClick = (e: React.MouseEvent) => {
							e.stopPropagation();
							if (liveUrl) {
								window.open(liveUrl, "_blank");
							}
						};

						return (
							<div
								key={`${svc.path}::${svc.name}`}
								role="button"
								tabIndex={0}
								onClick={handleCardClick}
								onKeyDown={handleCardKeyDown}
								className={`hover:cursor-pointer rounded-xl border p-4 text-left bg-card hover:border-primary/40 transition-colors ${isFailed ? "border-destructive/60" : "border-border"
									}`}
							>
								<div className="flex items-center gap-3">
									<Github className="size-6 shrink-0 text-muted-foreground" />
									<span className="font-semibold text-foreground truncate">
										@{repoName}/{svc.name}
									</span>
								</div>
								<div className="mt-1 text-xs text-muted-foreground font-mono truncate" title={svc.path}>
									{svc.path === "." ? "Root: ." : svc.path}
								</div>
								<div className="mt-3 flex flex-col gap-2">
									<div className="flex items-center gap-2">
										{isDraft && (
											<span className="text-sm text-muted-foreground">
												Draft (Not Deployed)
											</span>
										)}
										{hasNoDeployment && (
											<span className="text-sm text-muted-foreground">
												Not Deployed
											</span>
										)}
										{isFailed && (
											<>
												<span className="text-sm text-destructive flex items-center gap-1">
													Failed
												</span>
												<span className="flex items-center gap-0.5 text-destructive/80">
													<AlertTriangle className="size-4" />
												</span>
											</>
										)}
										{isOnline && (
											<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
												<span className="size-2 rounded-full bg-green-500" />
												Online
											</span>
										)}
									</div>
									{liveUrl && isOnline && (
										<a
											href={liveUrl}
											target="_blank"
											rel="noopener noreferrer"
											onClick={handleLiveUrlClick}
											className="text-sm text-blue-600 dark:text-blue-400 hover:underline text-left truncate"
										>
											{liveUrl}
										</a>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Sheet open={sheet === "add"} onOpenChange={(o) => !o && setSheet(null)}>
				<SheetContent side="right" className="w-full sm:max-w-md">
					<SheetHeader>
						<SheetTitle>Add service</SheetTitle>
						<SheetDescription>
							Set the repository subdirectory SmartDeploy should use as this service’s root. Use{" "}
							<code className="rounded bg-muted px-1">.</code> for the repository root.
						</SheetDescription>
					</SheetHeader>
					<div className="mt-6 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="svc-root-path">Root path</Label>
							<Input
								id="svc-root-path"
								value={rootPath}
								onChange={(e) => setRootPath(e.target.value)}
								placeholder="e.g. apps/web or ."
								disabled={busy}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="svc-display-name">Display name (optional)</Label>
							<Input
								id="svc-display-name"
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
								placeholder="Defaults from folder or repo name"
								disabled={busy}
							/>
						</div>
						<Button type="button" className="w-full" disabled={busy} onClick={() => void submitAdd()}>
							{busy ? "Saving…" : "Add service"}
						</Button>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
