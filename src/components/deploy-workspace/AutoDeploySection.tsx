"use client";

import * as React from "react";
import { DeployConfig, repoType } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { GitBranch, Link2 } from "lucide-react";

type AutoDeploySectionProps = {
	deployment: DeployConfig;
	repo: repoType;
	onPatch: (partial: Partial<DeployConfig>) => Promise<void> | void;
};

export default function AutoDeploySection({ deployment, repo, onPatch }: AutoDeploySectionProps) {
	const slug = (process.env.NEXT_PUBLIC_GITHUB_APP_SLUG || "").trim();
	const owner = repo.owner?.login?.trim() || "";
	const [branchInput, setBranchInput] = React.useState(
		() => deployment.auto_deploy_branch?.trim() || deployment.branch?.trim() || "main"
	);

	React.useEffect(() => {
		setBranchInput(deployment.auto_deploy_branch?.trim() || deployment.branch?.trim() || "main");
	}, [deployment.auto_deploy_branch, deployment.branch]);

	const installHref = React.useMemo(() => {
		if (!slug || !owner) return "";
		const state = encodeURIComponent(
			JSON.stringify({
				owner,
				repo_name: deployment.repo_name,
				service_name: deployment.service_name,
			})
		);
		return `https://github.com/apps/${slug}/installations/new?state=${state}`;
	}, [slug, owner, deployment.repo_name, deployment.service_name]);

	const linked = Boolean(deployment.github_installation_id);

	async function onToggle(checked: boolean) {
		if (checked && !linked) {
			toast.error("Install the GitHub App on your account or org first, then return here.");
			return;
		}
		await onPatch({ auto_deploy_enabled: checked });
		toast.success(checked ? "Auto-deploy on push enabled" : "Auto-deploy disabled");
	}

	async function saveBranch() {
		const b = branchInput.trim() || "main";
		setBranchInput(b);
		await onPatch({ auto_deploy_branch: b });
		toast.success("Auto-deploy branch saved");
	}

	return (
		<div className="rounded-xl border border-border bg-card p-4 space-y-4">
			<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				<Link2 className="size-3.5 opacity-70" aria-hidden />
				<span>Auto-deploy (GitHub)</span>
			</div>
			<p className="text-sm text-muted-foreground">
				Deploy this service automatically when you push to a branch. Requires the SmartDeploy GitHub App on the repository
				and the deploy worker running to receive webhooks.
			</p>
			{!slug ? (
				<p className="text-xs text-amber-600 dark:text-amber-400">
					Set <span className="font-mono">NEXT_PUBLIC_GITHUB_APP_SLUG</span> to show the Install button.
				</p>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" asChild disabled={!installHref}>
						<a href={installHref || "#"} target="_blank" rel="noopener noreferrer">
							Install / configure GitHub App
						</a>
					</Button>
					<span className="text-xs text-muted-foreground">
						GitHub App setup URL (after installation):{" "}
						<span className="font-mono break-all">
							{typeof window !== "undefined" ? `${window.location.origin}/api/github-app/setup` : "…/api/github-app/setup"}
						</span>
					</span>
				</div>
			)}
			<div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
				<div>
					<p className="text-sm font-medium text-foreground">App installation</p>
					<p className="text-xs text-muted-foreground">
						{linked ? `Connected (installation #${deployment.github_installation_id})` : "Not linked yet"}
					</p>
				</div>
			</div>
			<div className="flex items-center justify-between gap-4">
				<div className="space-y-0.5">
					<Label htmlFor="auto-deploy-toggle" className="text-sm font-medium">
						Deploy on push
					</Label>
					<p className="text-xs text-muted-foreground">Only for the branch below</p>
				</div>
				<Switch
					id="auto-deploy-toggle"
					checked={Boolean(deployment.auto_deploy_enabled)}
					onCheckedChange={(v) => void onToggle(v)}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="auto-deploy-branch" className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
					<GitBranch className="size-3.5" aria-hidden />
					Branch
				</Label>
				<div className="flex flex-wrap gap-2">
					<Input
						id="auto-deploy-branch"
						value={branchInput}
						onChange={(e) => setBranchInput(e.target.value)}
						className="max-w-[220px] font-mono text-sm"
						placeholder="main"
					/>
					<Button type="button" variant="secondary" size="sm" onClick={() => void saveBranch()}>
						Save branch
					</Button>
				</div>
			</div>
		</div>
	);
}
