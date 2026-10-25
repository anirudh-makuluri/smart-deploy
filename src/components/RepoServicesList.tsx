"use client";

import * as React from "react";
import { FolderPlus, RefreshCw } from "lucide-react";
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
import { RepoServiceCard } from "@/components/repo-services/RepoServiceCard";

export type RepoCatalogActions = {
	busy: boolean;
	onAddService: (rootPath: string, displayName?: string) => Promise<boolean>;
	onRefresh?: () => Promise<boolean>;
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
	openWorkspaceForService: (svc: DetectedServiceInfo) => void | Promise<void>;
	catalogActions?: RepoCatalogActions;
};

interface RepoServicesHeaderProps {
	owner: string;
	repoName: string;
	serviceCount: number;
	catalogActions: RepoCatalogActions | null;
	showActions: boolean;
	onAddService: () => void;
}

function RepoServicesHeader({ owner, repoName, serviceCount, catalogActions, showActions, onAddService }: RepoServicesHeaderProps) {
	const busy = catalogActions?.busy ?? false;
	return (
		<div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
			<div>
				<h1 className="text-xl font-semibold text-foreground">
					{owner} / {repoName}
				</h1>
				<p className="text-sm text-muted-foreground mt-0.5">
					{serviceCount} service{serviceCount !== 1 ? "s" : ""}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{catalogActions && showActions && (
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="shrink-0"
							disabled={busy}
							onClick={() => void catalogActions.onRefresh?.()}
						>
							<RefreshCw className={`size-4 mr-1.5 ${busy ? "animate-spin" : ""}`} />
							Refresh detection
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="shrink-0"
							disabled={busy}
							onClick={onAddService}
						>
							<FolderPlus className="size-4 mr-1.5" />
							Add service
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

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
			<RepoServicesHeader owner={owner} repoName={repoName} serviceCount={services.length}
				catalogActions={catalogActions ?? null} showActions={!loading && !error} onAddService={() => setSheet("add")} />

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
					{services.map((svc) => (
						<RepoServiceCard key={`${svc.path}::${svc.name}`} service={svc}
							deployment={getDeploymentForService(repoDeployments, repoUrl, svc.name, resolvedRepo.name) ?? null}
							onOpenWorkspace={openWorkspaceForService} />
					))}
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
