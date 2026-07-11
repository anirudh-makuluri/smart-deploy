"use client";

import * as React from "react";
import { CheckCircle2, Circle, Clock, Globe, Loader2, Rocket, Terminal } from "lucide-react";
import { AnimatePresence, m } from "framer-motion";
import type { DemoStoryContext } from "@/lib/landing/demoRepos";
import { DEPLOY_LOG_LINES } from "@/lib/landing/interactiveDemo";
import {
	SCAN_LOG_COUNT,
	SCAN_LOG_LINES,
	SCAN_NODES,
	getScanNodeStatus,
	isScanComplete,
	type ScanNodeStatus,
} from "@/lib/landing/scanTimeline";
import {
	BLUEPRINT_STAGES,
	getBlueprintStageStatus,
	isBlueprintComplete,
	type BlueprintStageStatus,
} from "@/lib/landing/blueprint";

function SetupSecretsMock({ secrets }: { secrets: ReadonlyArray<string> }) {
	return (
		<div className="demo-mock-card demo-setup-secrets min-w-0 rounded-lg border border-border/60 bg-card/70">
			<div className="demo-setup-secrets-inner">
				<div className="demo-setup-secrets-head">
					<p className="demo-text-label font-semibold uppercase text-muted-foreground">Secrets</p>
					<span className="demo-text-micro rounded border border-border/50 bg-background/40 px-1 py-0.5 font-semibold text-muted-foreground">
						{secrets.length}
					</span>
				</div>
				<div className="demo-setup-secrets-list">
					{secrets.map((secretKey) => (
						<div key={secretKey} className="demo-setup-secret-chip">
							<span className="demo-text-mono min-w-0 truncate font-mono text-foreground">{secretKey}</span>
							<span className="demo-text-micro shrink-0 tracking-widest text-muted-foreground">••••</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function SetupMock({ context, compact }: { context: DemoStoryContext; compact: boolean }) {
	if (compact) {
		return (
			<div className="demo-mock-root demo-setup-root h-full min-h-0 overflow-hidden rounded-xl border border-border/65 bg-background/70">
				<div className="demo-mock-card demo-setup-source shrink-0 rounded-lg border border-border/60 bg-card/70">
					<div className="demo-setup-source-head flex items-center justify-between gap-2">
						<p className="demo-text-label font-semibold uppercase text-muted-foreground">Project source</p>
						<div className="flex flex-wrap justify-end gap-[var(--demo-gap-sm)]">
							{context.services.map((service) => (
								<span
									key={service}
									className="demo-repo-chip rounded-md border border-primary/35 bg-primary/10 font-medium text-primary"
								>
									{service}
								</span>
							))}
						</div>
					</div>
					<div className="demo-setup-source-line mt-0.5 flex min-w-0 items-baseline gap-1">
						<p className="demo-text-title shrink-0 truncate font-medium text-foreground">{context.serviceLabel}</p>
						<p className="demo-text-mono min-w-0 truncate font-mono text-muted-foreground">
							· github.com/{context.repoSlug}
						</p>
					</div>
				</div>

				<div className="demo-setup-fields">
					<div className="demo-setup-grid demo-setup-grid-primary">
						<div className="demo-mock-card demo-setup-field min-w-0 rounded-lg border border-border/60 bg-card/70">
							<p className="demo-text-label font-semibold uppercase text-muted-foreground">Branch</p>
							<div className="demo-setup-value demo-text-body truncate border border-primary/35 bg-primary/10 font-medium text-primary">
								{context.branch}
							</div>
						</div>
						<div className="demo-mock-card demo-setup-field min-w-0 rounded-lg border border-border/60 bg-card/70">
							<p className="demo-text-label font-semibold uppercase text-muted-foreground">Target</p>
							<div className="demo-setup-value demo-text-body truncate border border-border/60 bg-background/70 text-foreground">
								{context.targetLabel}
							</div>
						</div>
						<div className="demo-mock-card demo-setup-field min-w-0 rounded-lg border border-border/60 bg-card/70">
							<p className="demo-text-label font-semibold uppercase text-muted-foreground">Framework</p>
							<div className="demo-setup-value demo-text-body truncate border border-border/60 bg-background/70 text-foreground">
								{context.framework}
							</div>
						</div>
					</div>
					<div className="demo-setup-grid demo-setup-grid-secondary">
						<div className="demo-mock-card demo-setup-field min-w-0 rounded-lg border border-border/60 bg-card/70">
							<p className="demo-text-label font-semibold uppercase text-muted-foreground">Region</p>
							<div className="demo-setup-value demo-text-mono truncate border border-border/60 bg-background/70 font-mono text-foreground">
								{context.region}
							</div>
						</div>
						<div className="demo-mock-card demo-setup-field min-w-0 rounded-lg border border-border/60 bg-card/70">
							<p className="demo-text-label font-semibold uppercase text-muted-foreground">Domain</p>
							<div className="demo-setup-value demo-text-mono truncate border border-border/60 bg-background/70 font-mono text-foreground">
								{context.customDomain}
							</div>
						</div>
					</div>
					<SetupSecretsMock secrets={context.secrets} />
				</div>
			</div>
		);
	}

	return (
		<div className="h-full space-y-3 overflow-hidden rounded-xl border border-border/65 bg-background/70 p-3.5">
			<div className="rounded-lg border border-border/60 bg-card/70 p-3">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Project source</p>
				<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
					<p className="text-[13px] font-medium text-foreground">{context.serviceLabel}</p>
					<p className="mt-0.5 font-mono text-[11px] text-muted-foreground">github.com/{context.repoSlug}</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{context.services.map((service) => (
					<span
						key={service}
						className="rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
					>
						{service}
					</span>
				))}
			</div>
			<div className="grid gap-2.5 sm:grid-cols-2">
				<div className="rounded-lg border border-border/60 bg-card/70 p-3">
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Branch</p>
					<div className="mt-2 rounded-md border border-primary/35 bg-primary/10 px-2.5 py-2 text-[13px] font-medium text-primary">
						{context.branch}
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/70 p-3">
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Target</p>
					<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2 text-[13px] text-foreground">
						{context.targetLabel}
					</div>
				</div>
			</div>
			<div className="rounded-lg border border-border/60 bg-card/70 p-3">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Framework</p>
				<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2 text-[13px] text-foreground">
					{context.framework}
				</div>
			</div>
		</div>
	);
}

function nodeStatusStyle(status: ScanNodeStatus): string {
	if (status === "done") return "border-accent/40 bg-accent/10";
	if (status === "running") return "border-primary/50 bg-primary/10 shadow-[0_0_18px_-6px_var(--primary)]";
	return "border-border/45 bg-background/40 opacity-60";
}

function NodeIcon({ status, compact }: { status: ScanNodeStatus; compact: boolean }) {
	const iconClass = compact ? "demo-node-icon shrink-0" : "size-4 shrink-0";
	if (status === "done") return <CheckCircle2 className={`${iconClass} text-accent`} />;
	if (status === "running") return <Loader2 className={`${iconClass} animate-spin text-primary`} />;
	return <Circle className={`${iconClass} text-muted-foreground`} />;
}

export function ScanResultsMock({
	context,
	visibleLineCount,
	compact = false,
}: {
	context: DemoStoryContext;
	visibleLineCount: number;
	compact: boolean;
}) {
	const complete = isScanComplete(visibleLineCount);
	const visibleLines = SCAN_LOG_LINES.slice(0, visibleLineCount);

	return (
		<div
			className={`flex h-full flex-col overflow-hidden rounded-xl border border-border/65 bg-background/70 ${
				compact ? "demo-mock-root" : "p-3.5"
			}`}
		>
			<AnimatePresence>
				{complete ? (
					<m.div
						key="summary"
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{ duration: 0.32, ease: "easeOut" }}
						className={`flex shrink-0 items-start gap-2.5 ${compact ? "mb-[var(--demo-gap-sm)]" : "mb-3"}`}
					>
						<div className={`rounded-md bg-primary/12 ${compact ? "p-1" : "p-1.5"}`}>
							<Terminal className={compact ? "demo-node-icon text-primary" : "size-4 text-primary"} />
						</div>
						<div className="min-w-0">
							<p className={`font-semibold text-foreground ${compact ? "demo-text-title" : "text-[13px]"}`}>
								Smart Analysis complete
							</p>
							<p className={`text-muted-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
								{classifySummary(context.framework, context.services.length)}
							</p>
						</div>
					</m.div>
				) : (
					<div
						key="running"
						className={`flex shrink-0 items-center gap-2.5 ${compact ? "mb-[var(--demo-gap-sm)]" : "mb-3"}`}
					>
						<Loader2 className={compact ? "demo-node-icon animate-spin text-primary" : "size-4 animate-spin text-primary"} />
						<p className={`font-medium text-foreground ${compact ? "demo-text-title" : "text-[13px]"}`}>
							Running Smart Analysis…
						</p>
					</div>
				)}
			</AnimatePresence>

			<div className={`grid min-h-0 flex-1 ${compact ? "demo-scan-grid grid-cols-2" : "gap-3 md:grid-cols-2"}`}>
				<div className={`min-h-0 overflow-hidden ${compact ? "space-y-[var(--demo-gap-sm)]" : "space-y-1.5"}`}>
					<p
						className={`font-semibold uppercase text-muted-foreground ${compact ? "demo-text-label" : "text-[11px] tracking-[0.14em]"}`}
					>
						Workflow chain
					</p>
					{SCAN_NODES.map((node) => {
						const status = getScanNodeStatus(node.id, visibleLineCount);
						return (
							<div
								key={node.id}
								className={`rounded-md border transition-all duration-300 ${compact ? "demo-node-row" : "px-2.5 py-1.5"} ${nodeStatusStyle(status)}`}
							>
								<div className="flex items-center gap-2">
									<NodeIcon status={status} compact={compact} />
									<div className="min-w-0">
										<p className={`truncate font-medium text-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
											{node.label}
										</p>
										<p className={`truncate text-muted-foreground ${compact ? "demo-text-mono" : "text-[11px]"}`}>
											{node.desc}
										</p>
									</div>
								</div>
							</div>
						);
					})}
				</div>

				<div className="flex min-h-0 flex-col overflow-hidden">
					<p
						className={`font-semibold uppercase text-muted-foreground ${
							compact ? "demo-text-label mb-[var(--demo-gap-sm)]" : "mb-1.5 text-[11px] tracking-[0.14em]"
						}`}
					>
						Analysis log
					</p>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[#1e1e1e] bg-[#0d0d0d]">
						<ul
							className={`min-h-0 flex-1 space-y-1 overflow-hidden font-mono leading-relaxed ${
								compact ? "demo-text-mono p-[var(--demo-pad-inner)]" : "p-2.5 text-[11px]"
							}`}
						>
							<AnimatePresence initial={false}>
								{visibleLines.map((line, index) => (
									<m.li
										key={line.text}
										initial={{ opacity: 0, x: -6 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ duration: 0.2, ease: "easeOut" }}
										className={line.tone === "success" ? "text-emerald-300" : "text-primary"}
									>
										<span className="mr-1 text-slate-600">{String(index + 1).padStart(2, "0")}</span>
										{line.text}
									</m.li>
								))}
							</AnimatePresence>
						</ul>
						<div className={`border-t border-[#1e1e1e] bg-[#0a0a0a] ${compact ? "px-[var(--demo-pad-inner)] py-[var(--demo-gap-sm)]" : "px-2.5 py-2"}`}>
							<div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
								<div
									className="h-full rounded-full bg-primary transition-all duration-200"
									style={{ width: `${(visibleLineCount / SCAN_LOG_COUNT) * 100}%` }}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function classifySummary(framework: string, serviceCount: number): string {
	if (serviceCount > 1) {
		return `Detected ${framework} across ${serviceCount} services — Railpack plan ready.`;
	}
	return `Detected ${framework} — Railpack build plan ready.`;
}

function stageStyle(status: BlueprintStageStatus): string {
	if (status === "ok") return "border-accent/40 bg-card/80";
	if (status === "active") return "border-primary/55 bg-primary/8 shadow-[0_0_20px_-8px_var(--primary)]";
	return "border-border/45 bg-card/40 opacity-55";
}

function StageBadge({ status, compact }: { status: BlueprintStageStatus; compact: boolean }) {
	const badgeClass = compact ? "demo-text-micro" : "text-[9px]";
	if (status === "ok") {
		return (
			<span
				className={`mt-1 inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-semibold text-accent ${badgeClass}`}
			>
				<CheckCircle2 className={compact ? "demo-node-icon" : "size-2.5"} /> OK
			</span>
		);
	}
	if (status === "active") {
		return (
			<span
				className={`mt-1 inline-flex items-center gap-1 rounded-full border border-primary/45 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary ${badgeClass}`}
			>
				<Loader2 className={`${compact ? "demo-node-icon" : "size-2.5"} animate-spin`} /> …
			</span>
		);
	}
	return (
		<span
			className={`mt-1 inline-block rounded-full border border-border/50 bg-background/40 px-1.5 py-0.5 font-semibold text-muted-foreground ${badgeClass}`}
		>
			…
		</span>
	);
}

export function BlueprintMock({ resolvedCount, compact = false }: { resolvedCount: number; compact: boolean }) {
	const complete = isBlueprintComplete(resolvedCount);
	return (
		<div
			className={`flex h-full flex-col overflow-hidden rounded-xl border border-border/65 bg-background/70 ${
				compact ? "demo-mock-root" : "p-3.5"
			}`}
		>
			<div className={`shrink-0 rounded-lg border border-border/60 bg-card/70 ${compact ? "demo-mock-card" : "p-3"}`}>
				<p
					className={`font-semibold uppercase text-primary ${compact ? "demo-text-label" : "text-[11px] tracking-[0.14em]"}`}
				>
					Blueprint | AWS CodeBuild &rarr; ECS
				</p>
				<p className={`mt-1 font-semibold text-foreground ${compact ? "demo-text-title" : "text-[13px]"}`}>
					{complete ? "Full deploy pipeline — ready to ship" : "Drawing deploy pipeline…"}
				</p>
			</div>
			<div className={`min-h-0 flex-1 overflow-hidden ${compact ? "mt-[var(--demo-gap)]" : "mt-3"}`}>
				<div className={compact ? "demo-blueprint-track h-full" : "flex items-stretch gap-1 overflow-x-auto overflow-y-hidden pb-1"}>
					{BLUEPRINT_STAGES.map((stage, index) => {
						const status = getBlueprintStageStatus(index, resolvedCount);
						return (
							<React.Fragment key={stage.id}>
								<div
									className={`rounded-lg border transition-all duration-300 ${
										compact
											? `demo-blueprint-stage ${stageStyle(status)}`
											: `w-[104px] shrink-0 px-2.5 py-2 sm:w-[124px] ${stageStyle(status)}`
									}`}
								>
									<p
										className={`font-semibold uppercase text-muted-foreground ${
											compact ? "demo-text-micro" : "text-[9px] tracking-[0.14em]"
										}`}
									>
										{stage.kicker}
									</p>
									<p className={`mt-0.5 font-medium text-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
										{stage.label}
									</p>
									<p
										className={`mt-0.5 leading-tight text-muted-foreground ${compact ? "demo-text-micro" : "text-[10px]"}`}
									>
										{stage.detail}
									</p>
									<StageBadge status={status} compact={compact} />
								</div>
								{index < BLUEPRINT_STAGES.length - 1 && (
									<div
										className={`relative flex h-auto shrink-0 items-center ${
											compact ? "demo-blueprint-connector" : "w-3 sm:w-4"
										}`}
									>
										<div className="h-px w-full bg-border/50" />
										<div
											className="absolute inset-y-1/2 left-0 h-px bg-primary transition-all duration-300"
											style={{ width: index < resolvedCount ? "100%" : "0%" }}
										/>
									</div>
								)}
							</React.Fragment>
						);
					})}
				</div>
			</div>
		</div>
	);
}

export function DeployProgressMock({
	visibleLineCount,
	progress,
	compact = false,
}: {
	visibleLineCount: number;
	progress: number;
	compact: boolean;
}) {
	const lines = DEPLOY_LOG_LINES.slice(0, visibleLineCount);
	const isComplete = progress >= 100;

	return (
		<div className={`flex h-full flex-col overflow-hidden ${compact ? "gap-[var(--demo-gap)]" : "gap-3"}`}>
			<div
				className={`shrink-0 overflow-hidden rounded-xl border border-border/65 bg-background/70 ${
					compact ? "demo-mock-card" : "p-3.5"
				}`}
			>
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-2.5">
						<div className={`rounded-lg bg-primary/12 text-primary ${compact ? "p-1" : "p-1.5"}`}>
							{isComplete ? (
								<CheckCircle2 className={compact ? "demo-node-icon" : "size-4"} />
							) : (
								<Rocket className={compact ? "demo-node-icon" : "size-4"} />
							)}
						</div>
						<div>
							<p className={`font-semibold text-foreground ${compact ? "demo-text-title" : "text-[13px]"}`}>
								{isComplete ? "Deployment live" : "Deploy in progress"}
							</p>
							<p className={`text-muted-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
								{isComplete ? "Health checks passed" : "Building and pushing to AWS"}
							</p>
						</div>
					</div>
					<span
						className={`shrink-0 rounded-full border border-primary/35 bg-primary/10 font-semibold uppercase tracking-[0.12em] text-primary ${
							compact ? "demo-text-micro px-1.5 py-0.5" : "px-2 py-0.5 text-[10px]"
						}`}
					>
						{isComplete ? "Done" : "Live"}
					</span>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#1e1e1e] bg-[#0d0d0d]">
				<div className={`border-b border-[#1e1e1e] bg-[#0a0a0a] ${compact ? "px-[var(--demo-pad-inner)] py-1" : "px-2.5 py-1.5"}`}>
					<p
						className={`font-semibold uppercase tracking-[0.14em] text-slate-400 ${
							compact ? "demo-text-micro" : "text-[10px]"
						}`}
					>
						Build &amp; Deploy Logs
					</p>
				</div>
				<ul
					className={`min-h-0 flex-1 space-y-1 overflow-hidden font-mono leading-relaxed ${
						compact ? "demo-text-mono p-[var(--demo-pad-inner)]" : "p-2.5 text-[11px]"
					}`}
				>
					{lines.map((log) => (
						<li key={log.id} className={log.tone === "success" ? "text-emerald-300" : "text-slate-300"}>
							{log.text}
						</li>
					))}
				</ul>
				<div className={`border-t border-[#1e1e1e] bg-[#0a0a0a] ${compact ? "px-[var(--demo-pad-inner)] py-[var(--demo-gap-sm)]" : "px-2.5 py-2"}`}>
					<div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
						<div
							className="h-full rounded-full bg-primary transition-all duration-300"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export function CompleteMock({ context, compact = false }: { context: DemoStoryContext; compact: boolean }) {
	return (
		<div className={`flex h-full flex-col overflow-hidden ${compact ? "gap-[var(--demo-gap)]" : "gap-3"}`}>
			<div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-[#0b0b0b] shadow-[0_24px_60px_-40px_rgba(0,0,0,0.9)]">
				<div
					className={`flex items-center gap-2 border-b border-white/8 bg-[#141414] ${
						compact ? "px-[var(--demo-pad-inner)] py-1.5" : "px-3 py-2"
					}`}
				>
					<span className={`rounded-full bg-[#ff5f57] ${compact ? "size-2" : "size-2.5"}`} />
					<span className={`rounded-full bg-[#febc2e] ${compact ? "size-2" : "size-2.5"}`} />
					<span className={`rounded-full bg-[#28c840] ${compact ? "size-2" : "size-2.5"}`} />
					<div
						className={`ml-2 flex flex-1 items-center gap-1.5 rounded-md border border-white/10 bg-black/40 ${
							compact ? "px-2 py-0.5" : "px-2.5 py-1"
						}`}
					>
						<Globe className={compact ? "demo-node-icon text-emerald-400" : "size-3 text-emerald-400"} />
						<span className={`truncate font-mono text-slate-300 ${compact ? "demo-text-mono" : "text-[11px]"}`}>
							https://{context.customDomain}
						</span>
					</div>
				</div>
				<PaintingInApp context={context} compact={compact} />
			</div>

			<div
				className={`flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary/25 bg-primary/6 ${
					compact ? "px-[var(--demo-pad-inner)] py-1.5" : "px-3 py-2"
				}`}
			>
				<Clock className={compact ? "demo-node-icon text-primary" : "size-3.5 text-primary"} />
				<p className={`font-medium text-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
					Shipped to {context.targetLabel} in {context.deployDurationLabel}
				</p>
			</div>

			<div className={`grid shrink-0 grid-cols-2 ${compact ? "gap-[var(--demo-gap-sm)]" : "gap-2"}`}>
				<div className={`rounded-lg border border-border/60 bg-card/75 ${compact ? "demo-mock-card" : "p-3"}`}>
					<p
						className={`uppercase tracking-[0.14em] text-muted-foreground ${compact ? "demo-text-micro" : "text-[10px]"}`}
					>
						Region
					</p>
					<p className={`mt-1 font-mono font-semibold text-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
						{context.region}
					</p>
				</div>
				<div className={`rounded-lg border border-border/60 bg-card/75 ${compact ? "demo-mock-card" : "p-3"}`}>
					<p
						className={`uppercase tracking-[0.14em] text-muted-foreground ${compact ? "demo-text-micro" : "text-[10px]"}`}
					>
						Services
					</p>
					<p className={`mt-1 font-semibold text-foreground ${compact ? "demo-text-body" : "text-[12px]"}`}>
						{context.services.join(" + ")}
					</p>
				</div>
			</div>
		</div>
	);
}

function PaintingInApp({ context, compact }: { context: DemoStoryContext; compact: boolean }) {
	const [painted, setPainted] = React.useState(false);

	React.useEffect(() => {
		const timer = setTimeout(() => setPainted(true), 650);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div
			className={`relative overflow-hidden bg-linear-to-b from-[#0f0f0f] to-[#080808] ${
				compact ? "h-full p-[var(--demo-pad-inner)]" : "h-40 p-4"
			}`}
		>
			<AnimatePresence mode="wait">
				{painted ? (
					<m.div
						key="content"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4, ease: "easeOut" }}
						className={compact ? "space-y-[var(--demo-gap-sm)]" : "space-y-2.5"}
					>
						<div className="flex items-center gap-2">
							<div className={`rounded-md bg-primary/30 ring-1 ring-primary/50 ${compact ? "size-5" : "size-6"}`} />
							<div className={`rounded-full bg-white/40 ${compact ? "h-2 w-12" : "h-2.5 w-16"}`} />
							<div className={`rounded-full bg-white/20 ${compact ? "h-2 w-8" : "h-2.5 w-10"}`} />
							<div
								className={`ml-auto flex items-center gap-1 rounded-full bg-emerald-400/15 ring-1 ring-emerald-400/40 ${
									compact ? "px-1 py-0.5" : "px-1.5 py-0.5"
								}`}
							>
								<span className={`animate-pulse rounded-full bg-emerald-400 ${compact ? "size-1" : "size-1.5"}`} />
								<span
									className={`font-semibold uppercase tracking-wide text-emerald-300 ${
										compact ? "demo-text-micro" : "text-[8px]"
									}`}
								>
									Live
								</span>
							</div>
						</div>
						<div
							className={`relative overflow-hidden rounded-lg border border-primary/25 bg-linear-to-br from-primary/35 via-primary/10 to-transparent ${
								compact ? "h-12" : "h-16"
							}`}
						>
							<div className={`absolute left-3 top-3 rounded-full bg-white/70 ${compact ? "h-1.5 w-14" : "h-2 w-20"}`} />
							<div className={`absolute left-3 top-7 rounded-full bg-white/30 ${compact ? "h-1 w-20" : "h-1.5 w-28"}`} />
							<div
								className={`absolute bottom-3 left-3 rounded-md bg-primary shadow-[0_6px_16px_-6px_rgba(245,165,36,0.7)] ${
									compact ? "h-3 w-12" : "h-4 w-16"
								}`}
							/>
						</div>
						<div className={`grid grid-cols-3 ${compact ? "gap-[var(--demo-gap-sm)]" : "gap-2"}`}>
							<div className={`rounded-md border border-white/10 bg-white/12 ${compact ? "h-6" : "h-8"}`} />
							<div className={`rounded-md border border-primary/25 bg-primary/12 ${compact ? "h-6" : "h-8"}`} />
							<div className={`rounded-md border border-white/10 bg-white/12 ${compact ? "h-6" : "h-8"}`} />
						</div>
						<p className={`pt-0.5 text-center text-slate-400 ${compact ? "demo-text-micro" : "text-[10px]"}`}>
							{context.serviceLabel} · live on your AWS
						</p>
					</m.div>
				) : (
					<div key="skeleton" className={compact ? "space-y-[var(--demo-gap-sm)]" : "space-y-2.5"}>
						<div className="flex items-center gap-2">
							<div className={`animate-pulse rounded-md bg-white/10 ${compact ? "size-5" : "size-6"}`} />
							<div className={`animate-pulse rounded-full bg-white/10 ${compact ? "h-2 w-16" : "h-2.5 w-24"}`} />
						</div>
						<div className={`animate-pulse rounded-lg bg-white/8 ${compact ? "h-12" : "h-16"}`} />
						<div className={`grid grid-cols-3 ${compact ? "gap-[var(--demo-gap-sm)]" : "gap-2"}`}>
							<div className={`animate-pulse rounded-md bg-white/8 ${compact ? "h-6" : "h-8"}`} />
							<div className={`animate-pulse rounded-md bg-white/8 ${compact ? "h-6" : "h-8"}`} />
							<div className={`animate-pulse rounded-md bg-white/8 ${compact ? "h-6" : "h-8"}`} />
						</div>
					</div>
				)}
			</AnimatePresence>
		</div>
	);
}
