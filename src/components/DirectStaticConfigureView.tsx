"use client";

import * as React from "react";
import type { SDArtifactsResponse } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { BadgeCheck, FolderTree, Hammer, Package, Rocket, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { directStaticCommandList, parseDirectStaticCommandList } from "@/lib/deploymentKind";

type DirectStaticConfigureViewProps = {
	results: SDArtifactsResponse;
	onUpdateResults: (results: SDArtifactsResponse) => void;
	onDeploy?: () => void;
	deployDisabled?: boolean;
	deployDisabledMessage?: string;
};

type DraftState = {
	workdir: string;
	install: string;
	build: string;
	outputDir: string;
	spaFallback: boolean;
	nginxConf: string;
};

function createDraft(results: SDArtifactsResponse): DraftState {
	return {
		workdir: results.workdir ?? ".",
		install: directStaticCommandList(results.install),
		build: directStaticCommandList(results.build),
		outputDir: results.output_dir ?? "dist",
		spaFallback: results.spa_fallback ?? true,
		nginxConf: results.nginx_conf ?? "",
	};
}

function summaryLabel(results: SDArtifactsResponse) {
	if (results.serviceType === "next-export") return "Next Export";
	if (results.serviceType === "static-html") return "Static HTML";
	if (!results.serviceType) return "Static";
	return results.serviceType.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function DirectStaticConfigureView({
	results,
	onUpdateResults,
	onDeploy,
	deployDisabled = false,
	deployDisabledMessage,
}: DirectStaticConfigureViewProps) {
	const [draft, setDraft] = React.useState<DraftState>(() => createDraft(results));
	const [showNginx, setShowNginx] = React.useState(false);

	React.useEffect(() => {
		setDraft(createDraft(results));
	}, [results]);

	const hasUnsavedChanges = React.useMemo(() => {
		const next = createDraft(results);
		return JSON.stringify(next) !== JSON.stringify(draft);
	}, [draft, results]);

	const handleSave = () => {
		const install = parseDirectStaticCommandList(draft.install);
		const build = parseDirectStaticCommandList(draft.build);
		const outputDir = draft.outputDir.trim() || ".";
		const workdir = draft.workdir.trim() || ".";
		const nginxConf = draft.nginxConf.trim();

		if (!outputDir) {
			toast.error("Output directory is required.");
			return;
		}
		if (!nginxConf) {
			toast.error("Nginx config is required.");
			return;
		}

		onUpdateResults({
			...results,
			workdir,
			install,
			build,
			output_dir: outputDir,
			spa_fallback: draft.spaFallback,
			nginx_conf: draft.nginxConf,
		});
		toast.success("Static deployment settings saved");
	};

	const statCards = [
		{ label: "Framework", value: summaryLabel(results), icon: Sparkles },
		{ label: "Package manager", value: (results.package_manager ?? "npm").toUpperCase(), icon: Package },
		{ label: "Publish output", value: draft.outputDir || ".", icon: Rocket },
	];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-6">
			<div className="rounded-[28px] border border-white/10 bg-card/95 p-7 shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
				<div className="flex flex-wrap items-start justify-between gap-5">
					<div className="max-w-2xl">
						<p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary/70">Direct Static Configure</p>
						<h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
							Rule-based build settings are ready before any smart scan.
						</h2>
						<p className="mt-3 text-sm leading-6 text-muted-foreground">
							This workspace is on the non-Docker path, so we prefilled the build and publish plan from the detected framework.
							You can tune the commands here before we wire the final direct deploy pipeline.
						</p>
					</div>
					<div className="grid min-w-[240px] grid-cols-1 gap-3 sm:grid-cols-3">
						{statCards.map((card) => {
							const Icon = card.icon;
							return (
								<div key={card.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
									<div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
										<Icon className="size-3.5" />
										{card.label}
									</div>
									<p className="mt-3 text-sm font-semibold text-foreground">{card.value}</p>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
				<section className="rounded-[28px] border border-white/10 bg-card/90 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.16)]">
					<div className="mb-6 flex items-center gap-3">
						<div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
							<Hammer className="size-5" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-foreground">Build recipe</h3>
							<p className="text-sm text-muted-foreground">Keep each phase to one command input so the workflow stays easy to scan.</p>
						</div>
					</div>
					<div className="space-y-5">
						<div className="grid gap-5 md:grid-cols-2">
							<div className="space-y-2">
								<label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Workdir</label>
								<Input
									value={draft.workdir}
									onChange={(event) => setDraft((current) => ({ ...current, workdir: event.target.value }))}
									className="border-white/10 bg-white/[0.03] font-mono text-sm text-foreground"
									placeholder="."
								/>
							</div>
							<div className="space-y-2">
								<label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Output directory</label>
								<Input
									value={draft.outputDir}
									onChange={(event) => setDraft((current) => ({ ...current, outputDir: event.target.value }))}
									className="border-white/10 bg-white/[0.03] font-mono text-sm text-foreground"
									placeholder="dist"
								/>
							</div>
						</div>
						<div className="space-y-2">
							<label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Install command</label>
							<Input
								value={draft.install}
								onChange={(event) => setDraft((current) => ({ ...current, install: event.target.value }))}
								className="border-white/10 bg-white/[0.03] font-mono text-sm text-foreground"
								placeholder="pnpm install --frozen-lockfile"
							/>
						</div>
						<div className="space-y-2">
							<label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Build command</label>
							<Input
								value={draft.build}
								onChange={(event) => setDraft((current) => ({ ...current, build: event.target.value }))}
								className="border-white/10 bg-white/[0.03] font-mono text-sm text-foreground"
								placeholder="pnpm build"
							/>
						</div>
						<div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
							<div>
								<p className="text-sm font-semibold text-foreground">SPA fallback</p>
								<p className="text-xs text-muted-foreground">Serve `index.html` for app routes that aren&apos;t physical files.</p>
							</div>
							<Switch
								checked={draft.spaFallback}
								onCheckedChange={(checked) => setDraft((current) => ({ ...current, spaFallback: checked }))}
							/>
						</div>
					</div>
				</section>

				<section className="rounded-[28px] border border-white/10 bg-card/90 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.14)]">
					<div className="mb-5 flex items-center gap-3">
						<div className="rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
							<FolderTree className="size-5" />
						</div>
						<div>
							<h3 className="text-lg font-semibold text-foreground">Publish plan</h3>
							<p className="text-sm text-muted-foreground">This is the concrete static hosting shape the deploy preview will follow.</p>
						</div>
					</div>
					<div className="space-y-4">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
							<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Pipeline outline</p>
							<ol className="mt-3 space-y-2 text-sm text-muted-foreground">
								<li>1. Install dependencies inside <span className="font-mono text-foreground">{draft.workdir || "."}</span></li>
								<li>2. Run the build commands exactly as configured</li>
								<li>3. Copy <span className="font-mono text-foreground">{draft.outputDir || "."}</span> into the nginx web root</li>
								<li>4. Reload nginx with the materialized config below</li>
							</ol>
						</div>

						<button
							type="button"
							onClick={() => setShowNginx((current) => !current)}
							className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.05]"
						>
							<div className="flex items-center gap-3">
								<ScrollText className="size-4 text-muted-foreground" />
								<div>
									<p className="text-sm font-semibold text-foreground">Nginx configuration</p>
									<p className="text-xs text-muted-foreground">Materialized now so the backend has deterministic input later.</p>
								</div>
							</div>
							<span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
								{showNginx ? "Hide" : "Show"}
							</span>
						</button>

						{showNginx ? (
							<Textarea
								value={draft.nginxConf}
								onChange={(event) => setDraft((current) => ({ ...current, nginxConf: event.target.value }))}
								className="min-h-[18rem] border-white/10 bg-background/70 font-mono text-xs leading-6 text-foreground"
							/>
						) : null}

						<div className="rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm">
							<div className="flex items-center gap-2 font-semibold text-foreground">
								<BadgeCheck className="size-4" />
								Static config is editable per deployment
							</div>
							<p className="mt-2 text-muted-foreground">
								These values live on this deployment only. Repo-level detection stays lightweight and reusable.
							</p>
						</div>
					</div>
				</section>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-card/90 px-6 py-5">
				<p className="text-sm text-muted-foreground">
					{hasUnsavedChanges ? "There are unsaved direct-static changes." : "Configuration is synced to deployment scan results."}
				</p>
				<div className="flex items-center gap-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => setDraft(createDraft(results))}
						disabled={!hasUnsavedChanges}
						className="border-white/10 bg-transparent text-foreground hover:bg-white/[0.05]"
					>
						Reset draft
					</Button>
					<Button type="button" onClick={handleSave} disabled={!hasUnsavedChanges}>
						Save configure view
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={onDeploy}
						disabled={deployDisabled}
						title={deployDisabledMessage}
						className="border-white/10 bg-white/[0.03] text-foreground hover:bg-white/[0.05] disabled:text-muted-foreground"
					>
						Deploy static app
					</Button>
				</div>
			</div>
		</div>
	);
}
