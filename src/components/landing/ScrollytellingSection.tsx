"use client";

import * as React from "react";
import { AnimatePresence, LazyMotion, domAnimation, m } from "framer-motion";
import {
	Bot,
	CheckCircle2,
	Circle,
	FileSearch,
	LayoutDashboard,
	Loader2,
	Logs,
	Rocket,
	Settings2,
	Terminal,
	History,
	Boxes,
	XCircle,
} from "lucide-react";

type Step = {
	title: string;
	description: string;
	section: "overview" | "setup" | "scan" | "blueprint" | "logs" | "history";
};

type NodeId = "overview" | "setup" | "scan" | "blueprint" | "logs" | "history";
type NodeState = "idle" | "active" | "success";

type LogEntry = {
	id: number;
	text: string;
	tone?: "default" | "error" | "success";
};

const steps: Step[] = [
	{
		title: "Overview: Your deployment at a glance",
		description: "See deploy status, live URLs, and configuration — everything about your deployment in one dashboard.",
		section: "overview",
	},
	{
		title: "Setup: Configure your deployment",
		description: "Connect a GitHub repo, pick a branch, choose cloud provider, set environment variables and custom domains.",
		section: "setup",
	},
	{
		title: "Scan: AI analyzes your project",
		description: "AI clones your repo, classifies the deploy shape, generates a Railpack build plan, and verifies it builds — with auto-repair if it fails.",
		section: "scan",
	},
	{
		title: "Blueprint: Preview before shipping",
		description: "Review the full deploy pipeline — see every stage, artifact, and routing config before anything goes live.",
		section: "blueprint",
	},
	{
		title: "Logs: Watch it happen in real time",
		description: "Stream build and deploy logs live. If something fails, AI diagnoses the root cause and suggests fixes.",
		section: "logs",
	},
	{
		title: "History: Every deploy, recorded",
		description: "Full deployment history with commit info, durations, and one-click rollback to any previous version.",
		section: "history",
	},
];

const MENU_ICONS: Record<NodeId, React.ComponentType<{ className?: string }>> = {
	overview: LayoutDashboard,
	setup: Settings2,
	scan: FileSearch,
	blueprint: Boxes,
	logs: Logs,
	history: History,
};

const storyContext = {
	serviceLabel: "api@smart-deploy",
	repoSlug: "aniru/smart-deploy",
	branch: "main",
	instanceType: "t3.small",
	region: "us-west-2",
	customDomain: "my-app.smart-deploy.xyz",
	deploymentTarget: "AWS / ECS",
};

const scanWorkflowNodes = [
	{ id: "scanner", label: "Scanner", desc: "Resolve commit and repo scope" },
	{ id: "clone_repo", label: "Clone repo", desc: "Check out repository at commit" },
	{ id: "classifier", label: "Classifier", desc: "Detect deploy shape and units" },
	{ id: "railpack_prepare", label: "Railpack prepare", desc: "Generate Railpack build plan" },
	{ id: "deploy_briefing", label: "Deploy briefing", desc: "Operator summary (markdown)" },
	{ id: "railpack_build_repair", label: "Build & repair", desc: "Verify build; AI repair loop" },
	{ id: "finalize", label: "Finalize", desc: "Schema version and final status" },
];

const scanLogMessages = [
	"[scanner] resolving commit HEAD on main",
	"[clone] checking out repo at a3f82d1",
	"[classifier] detected: Next.js web app",
	"[classifier] deploy shape: single-service container",
	"[railpack] generating build plan...",
	"[railpack] plan ready: 4 layers, node 20 base",
	"[briefing] operator summary generated",
	"[build] verifying build passes...",
	"[build] build passed on first attempt",
	"[finalize] schema v2 — analysis complete",
];

const previewStages = [
	{ id: "auth", label: "Resolve ref" },
	{ id: "build", label: "Build images" },
	{ id: "setup", label: "Provision infra" },
	{ id: "deploy", label: "Deploy + route" },
	{ id: "done", label: "Publish domain" },
];

const historyEntries = [
	{ sha: "a3f82d1", branch: "main", status: "success" as const, ago: "2 hours ago" },
	{ sha: "7c91fe4", branch: "main", status: "success" as const, ago: "5 hours ago" },
	{ sha: "e4b12c8", branch: "develop", status: "failed" as const, ago: "1 day ago" },
	{ sha: "9d3a7f2", branch: "main", status: "success" as const, ago: "2 days ago" },
];

const DEPLOY_LOG_LINES: LogEntry[] = [
	{ id: 1, text: "[build] pulling base image...", tone: "default" },
	{ id: 2, text: "[build] layer 1/4 cached", tone: "default" },
	{ id: 3, text: "[build] layer 2/4 cached", tone: "default" },
	{ id: 4, text: "[build] layer 3/4 building...", tone: "default" },
	{ id: 5, text: "[build] layer 4/4 complete", tone: "success" },
	{ id: 6, text: "[deploy] pushing to ECR...", tone: "default" },
	{ id: 7, text: "[deploy] updating ECS service...", tone: "default" },
	{ id: 8, text: "[deploy] health check passed", tone: "success" },
	{ id: 9, text: "[deploy] traffic shifted to new task", tone: "success" },
];

function getNodeStates(activeStep: number): Record<NodeId, NodeState> {
	const sections: NodeId[] = ["overview", "setup", "scan", "blueprint", "logs", "history"];
	const states: Record<NodeId, NodeState> = {
		overview: "idle", setup: "idle", scan: "idle",
		blueprint: "idle", logs: "idle", history: "idle",
	};

	for (let i = 0; i < sections.length; i++) {
		if (i < activeStep) states[sections[i]] = "success";
		else if (i === activeStep) states[sections[i]] = "active";
	}
	return states;
}

function StepItem({
	index,
	step,
	isActive,
	onRef,
}: {
	index: number;
	step: Step;
	isActive: boolean;
	onRef: (index: number, node: HTMLDivElement | null) => void;
}) {
	const Icon = MENU_ICONS[step.section];
	return (
		<div
			ref={(node) => onRef(index, node)}
			data-step-index={index}
			className="flex h-[60vh] items-center py-6 sm:h-[68vh] sm:py-8 lg:h-[75vh]"
		>
			<m.article
				layout
				animate={{ opacity: isActive ? 1 : 0.5, y: isActive ? 0 : 8 }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				className={`landing-panel landing-shell w-full rounded-2xl border p-6 sm:p-8 ${
					isActive ? "border-border/75 bg-card/90 shadow-sm" : "border-border/55 bg-background/60"
				}`}
			>
				<div className="flex items-center gap-2.5">
					<div className={`flex size-8 items-center justify-center rounded-lg ${isActive ? "bg-primary/12 text-primary" : "bg-muted/50 text-muted-foreground"}`}>
						<Icon className="size-4" />
					</div>
					<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
						{step.section}
					</p>
				</div>
				<h3 className="mt-3 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{step.title}</h3>
				<p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
			</m.article>
		</div>
	);
}

function OverviewMock() {
	return (
		<div className="space-y-3">
			<div className="relative overflow-hidden rounded-xl border border-primary/25 bg-primary/6 p-3">
				<div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/20 blur-2xl" aria-hidden />
				<div className="relative flex items-start justify-between gap-3">
					<div className="flex items-start gap-2.5">
						<div className="rounded-lg bg-primary/18 p-1.5 text-primary">
							<CheckCircle2 className="size-4" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">Deployment Live</p>
							<p className="text-[11px] text-muted-foreground">{storyContext.customDomain}</p>
						</div>
					</div>
					<span className="rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
						Healthy
					</span>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
					<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Region</p>
					<p className="mt-1 font-mono text-xs font-semibold text-foreground">{storyContext.region}</p>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
					<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Target</p>
					<p className="mt-1 text-xs font-semibold text-foreground">{storyContext.deploymentTarget}</p>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
					<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Branch</p>
					<p className="mt-1 font-mono text-xs font-semibold text-foreground">{storyContext.branch}</p>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
					<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Revision</p>
					<p className="mt-1 font-mono text-xs font-semibold text-foreground">#4</p>
				</div>
			</div>
		</div>
	);
}

function SetupMock() {
	return (
		<div className="space-y-2.5 rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Project source</p>
				<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
					<p className="text-xs font-medium text-foreground">{storyContext.serviceLabel}</p>
					<p className="mt-0.5 font-mono text-[10px] text-muted-foreground">github.com/{storyContext.repoSlug}</p>
				</div>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Branch</p>
					<div className="mt-2 rounded-md border border-primary/35 bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary">
						{storyContext.branch}
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Instance</p>
					<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs text-foreground">
						{storyContext.instanceType}
					</div>
				</div>
			</div>
			<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Custom domain</p>
				<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
					https://{storyContext.customDomain}
				</div>
			</div>
		</div>
	);
}

function ScanMock({ isVisible }: { isVisible: boolean }) {
	const [activeLine, setActiveLine] = React.useState(0);
	const [logs, setLogs] = React.useState<LogEntry[]>([]);

	React.useEffect(() => {
		if (!isVisible) return;
		let line = 0;
		const interval = setInterval(() => {
			line++;
			if (line >= scanWorkflowNodes.length) {
				clearInterval(interval);
				setActiveLine(scanWorkflowNodes.length);
				return;
			}
			setActiveLine(line);
		}, 900);
		return () => clearInterval(interval);
	}, [isVisible]);

	React.useEffect(() => {
		if (!isVisible) return;
		let idx = 0;
		const interval = setInterval(() => {
			if (idx >= scanLogMessages.length) { clearInterval(interval); return; }
			setLogs((prev) => [...prev, { id: idx, text: scanLogMessages[idx] }]);
			idx++;
		}, 650);
		return () => clearInterval(interval);
	}, [isVisible]);

	const isScanComplete = activeLine >= scanWorkflowNodes.length;
	const progress = isScanComplete ? 100 : Math.round(((activeLine + 1) / scanWorkflowNodes.length) * 100);

	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="mb-3 flex items-start gap-2.5">
				<div className="rounded-md bg-primary/10 p-1.5">
					<Terminal className="size-3.5 text-primary" />
				</div>
				<div>
					<p className="text-xs font-semibold text-foreground">Smart Analysis</p>
					<p className="text-[11px] text-muted-foreground">Classifying repo, building plan, verifying build</p>
				</div>
			</div>

			<div className="grid gap-3 md:grid-cols-2">
				<div className="space-y-1.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workflow chain</p>
					{scanWorkflowNodes.map((node, index) => {
						const isCompleted = index < activeLine || isScanComplete;
						const isActive = !isScanComplete && index === activeLine;
						return (
							<m.div
								key={node.id}
								layout
								className={`rounded-md border px-2 py-1.5 ${
									isActive
										? "border-primary/35 bg-primary/10"
										: isCompleted
											? "border-accent/35 bg-accent/10"
											: "border-border/60 bg-card/70"
								}`}
							>
								<div className="flex items-center gap-2">
									{isCompleted ? (
										<CheckCircle2 className="size-3.5 text-accent" />
									) : isActive ? (
										<Loader2 className="size-3.5 animate-spin text-primary" />
									) : (
										<Circle className="size-3.5 text-muted-foreground/70" />
									)}
									<div className="min-w-0">
										<p className={`truncate text-xs font-medium ${isActive ? "text-primary" : "text-foreground"}`}>{node.label}</p>
										<p className="truncate text-[10px] text-muted-foreground">{node.desc}</p>
									</div>
								</div>
							</m.div>
						);
					})}
				</div>

				<div className="flex flex-col">
					<div className="mb-1.5 flex items-center justify-between">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live stream</p>
						<div className="flex items-center gap-1.5">
							<span className="relative flex size-2">
								<span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/80" />
								<span className="relative inline-flex size-2 rounded-full bg-primary" />
							</span>
						</div>
					</div>
					<div className="overflow-hidden rounded-md border border-[#1e1e1e] bg-[#0d0d0d] flex-1">
						<m.ul layout className="min-h-36 space-y-1 overflow-hidden p-2 font-mono text-[10px]">
							<AnimatePresence initial={false}>
								{logs.map((log) => (
									<m.li
										key={log.id}
										layout
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.18, ease: "easeOut" }}
										className="text-violet-300"
									>
										{log.text}
									</m.li>
								))}
							</AnimatePresence>
						</m.ul>
						<div className="border-t border-[#1e1e1e] bg-[#0a0a0a] px-2 py-2">
							<div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
								<m.div
									layout
									className="h-full rounded-full bg-primary"
									animate={{ width: `${progress}%` }}
									transition={{ duration: 0.3, ease: "easeOut" }}
								/>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function BlueprintMock() {
	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
					Blueprint | AWS CodeBuild &rarr; ECS
				</p>
				<p className="mt-1 text-xs font-semibold text-foreground">Full deploy pipeline preview</p>
			</div>
			<div className="mt-3 overflow-x-auto pb-1">
				<div className="flex items-center gap-1">
					{previewStages.map((stage, index) => (
						<React.Fragment key={stage.id}>
							<div className="w-[90px] shrink-0 rounded-lg border border-border/60 bg-card/75 px-2 py-2 sm:w-[110px]">
								<p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{stage.id}</p>
								<p className="mt-0.5 text-[11px] font-medium text-foreground">{stage.label}</p>
								<span className="mt-1 inline-block rounded-full border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
									OK
								</span>
							</div>
							{index < previewStages.length - 1 && <div className="h-px w-2 shrink-0 bg-border/80 sm:w-3" />}
						</React.Fragment>
					))}
				</div>
			</div>
		</div>
	);
}

function LogsMock() {
	return (
		<div className="space-y-3">
			<div className="relative overflow-hidden rounded-xl border border-border/65 bg-background/70 p-3">
				<div className="absolute inset-x-0 top-0 h-[2px] bg-border/40" aria-hidden>
					<div className="h-full w-full bg-primary transition-all duration-700" />
				</div>
				<div className="flex items-start justify-between gap-3 pt-1">
					<div className="flex items-start gap-2.5">
						<div className="rounded-lg bg-primary/12 p-1.5 text-primary">
							<Rocket className="size-4" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">Deploy in Progress</p>
							<p className="text-[11px] text-muted-foreground">Building and pushing to AWS</p>
						</div>
					</div>
					<span className="rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
						Live
					</span>
				</div>
			</div>

			<div className="overflow-hidden rounded-xl border border-[#1e1e1e] bg-[#0d0d0d]">
				<div className="border-b border-[#1e1e1e] bg-[#0a0a0a] px-2 py-1.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Build & Deploy Logs</p>
				</div>
				<ul className="min-h-36 space-y-1 overflow-hidden p-2 font-mono text-[10px]">
					{DEPLOY_LOG_LINES.map((log) => (
						<li
							key={log.id}
							className={
								log.tone === "success"
									? "text-emerald-300"
									: log.tone === "error"
										? "text-rose-300"
										: "text-slate-300"
							}
						>
							{log.text}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function HistoryMock() {
	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Deployment History</p>
			<div className="mt-3 space-y-2">
				{historyEntries.map((entry) => (
					<div
						key={entry.sha}
						className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
							entry.status === "success"
								? "border-border/60 bg-card/75"
								: "border-destructive/30 bg-destructive/5"
						}`}
					>
						<div className="flex items-center gap-2.5">
							{entry.status === "success" ? (
								<CheckCircle2 className="size-3.5 text-accent" />
							) : (
								<XCircle className="size-3.5 text-destructive" />
							)}
							<div>
								<p className="font-mono text-xs font-medium text-foreground">{entry.sha}</p>
								<p className="text-[10px] text-muted-foreground">{entry.branch}</p>
							</div>
						</div>
						<div className="text-right">
							<p className="text-[10px] text-muted-foreground">{entry.ago}</p>
							{entry.status === "success" && (
								<span className="text-[9px] font-medium text-primary">Rollback</span>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function FlowUI({
	activeStep,
	isVisible,
	isCompact = false,
}: {
	activeStep: number;
	isVisible: boolean;
	isCompact?: boolean;
}) {
	const nodeStates = getNodeStates(activeStep);
	const sections: NodeId[] = ["overview", "setup", "scan", "blueprint", "logs", "history"];
	const sectionLabels: Record<NodeId, string> = {
		overview: "Overview",
		setup: "Setup",
		scan: "Scan",
		blueprint: "Preview",
		logs: "Logs",
		history: "History",
	};

	return (
		<div
			className={`landing-panel landing-shell mx-auto w-full rounded-2xl border border-border/70 bg-card/85 shadow-sm ${
				isCompact ? "max-w-none p-3 sm:p-4" : "max-w-184 p-4 sm:p-5"
			}`}
		>
			<div className="rounded-xl border border-border/65 bg-background/70 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
						<p className="text-xs font-medium text-foreground">{storyContext.serviceLabel}</p>
					</div>
					<div className="text-right text-[10px] text-muted-foreground">
						<p>{storyContext.branch}</p>
						<p>{storyContext.deploymentTarget}</p>
					</div>
				</div>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{isCompact ? (
						<span className="rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
							{sectionLabels[steps[activeStep]?.section ?? "overview"]}
						</span>
					) : (
						sections.map((section) => {
							const state = nodeStates[section];
							return (
								<span
									key={section}
									className={`rounded-md border px-2 py-1 text-[10px] font-medium ${
										state === "active"
											? "border-primary/35 bg-primary/10 text-primary"
											: state === "success"
												? "border-accent/35 bg-accent/10 text-accent"
												: "border-border/60 bg-card/70 text-muted-foreground"
									}`}
								>
									{sectionLabels[section]}
								</span>
							);
						})
					)}
				</div>
			</div>

			<div className={`mt-4 ${isCompact ? "min-h-0" : "min-[420px]:min-h-88 sm:min-h-96 lg:min-h-102"}`}>
				<AnimatePresence mode="wait">
					<m.div
						key={activeStep}
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						{activeStep === 0 && <OverviewMock />}
						{activeStep === 1 && <SetupMock />}
						{activeStep === 2 && (
							<ScanMock
								key={isVisible ? "scan-visible" : "scan-hidden"}
								isVisible={isVisible && activeStep === 2}
							/>
						)}
						{activeStep === 3 && <BlueprintMock />}
						{activeStep === 4 && <LogsMock />}
						{activeStep === 5 && <HistoryMock />}
					</m.div>
				</AnimatePresence>
			</div>
		</div>
	);
}

export function ScrollytellingSection() {
	const [activeStep, setActiveStep] = React.useState(0);
	const [isDesktop, setIsDesktop] = React.useState(
		() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
	);
	const [isSectionVisible, setIsSectionVisible] = React.useState(false);
	const stepRefs = React.useRef<Array<HTMLDivElement | null>>([]);
	const sectionRef = React.useRef<HTMLElement | null>(null);
	const visibilityObserverRef = React.useRef<IntersectionObserver | null>(null);

	const setSectionNode = React.useCallback((node: HTMLElement | null) => {
		sectionRef.current = node;
		visibilityObserverRef.current?.disconnect();
		visibilityObserverRef.current = null;
		if (!node) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				setIsSectionVisible(entry.isIntersecting && entry.intersectionRatio > 0.12);
			},
			{ threshold: [0, 0.12, 0.3] }
		);
		visibilityObserverRef.current = observer;
		observer.observe(node);
	}, []);

	const setStepRef = React.useCallback((index: number, node: HTMLDivElement | null) => {
		stepRefs.current[index] = node;
	}, []);

	React.useEffect(() => {
		const mediaQuery = window.matchMedia("(min-width: 1024px)");
		const syncLayout = () => setIsDesktop(mediaQuery.matches);
		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", syncLayout);
			return () => mediaQuery.removeEventListener("change", syncLayout);
		}
		mediaQuery.addListener(syncLayout);
		return () => mediaQuery.removeListener(syncLayout);
	}, []);

	React.useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				let nextIndex = 0;
				let highestRatio = 0;

				for (const entry of entries) {
					const index = Number((entry.target as HTMLElement).dataset.stepIndex);
					if (Number.isNaN(index) || !entry.isIntersecting) continue;
					if (entry.intersectionRatio > highestRatio) {
						highestRatio = entry.intersectionRatio;
						nextIndex = index;
					}
				}

				if (highestRatio > 0) {
					setActiveStep((previous) => (previous === nextIndex ? previous : nextIndex));
				}
			},
			{
				threshold: [0.2, 0.4, 0.6, 0.8],
				rootMargin: "-30% 0px -30% 0px",
			}
		);

		for (const node of stepRefs.current) {
			if (node) observer.observe(node);
		}

		return () => observer.disconnect();
	}, [isDesktop]);

	React.useEffect(() => () => visibilityObserverRef.current?.disconnect(), []);

	return (
		<LazyMotion features={domAnimation} strict>
		<section
			ref={setSectionNode}
			id="flow"
			className="w-full scroll-mt-20 border-t border-border/60 bg-muted/20 px-4 py-16 sm:scroll-mt-24 sm:px-6 sm:py-20 lg:px-10"
		>
			<div className="mx-auto max-w-7xl">
				<div className="mx-auto max-w-3xl text-center">
					<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">The Workspace</p>
					<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
						Six sections. One guided workflow.
					</h2>
					<p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
						Every deployment lives inside a workspace. Setup, scan, preview the blueprint, deploy, watch logs, and browse history — all without leaving the page.
					</p>
				</div>

				{isDesktop ? (
					<div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
						<div>
							{steps.map((step, index) => (
								<StepItem
									key={`${index}-${step.title}`}
									index={index}
									step={step}
									isActive={activeStep === index}
									onRef={setStepRef}
								/>
							))}
						</div>

						<div className="lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]">
							<div className="flex h-full items-start justify-center pt-1">
								<FlowUI activeStep={activeStep} isVisible={isSectionVisible} />
							</div>
						</div>
					</div>
				) : (
					<div className="mt-8 lg:hidden">
						<div className="sticky top-16 z-10 h-[calc(100svh-5.5rem)]">
							<div className="grid h-full grid-rows-[minmax(7rem,18svh)_minmax(0,1fr)] gap-3">
								<m.article
									key={`mobile-step-${activeStep}`}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.2, ease: "easeOut" }}
									className="landing-panel landing-shell rounded-2xl border border-border/70 bg-card/90 p-4"
								>
									<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
										{steps[activeStep]?.section} &middot; {activeStep + 1} of {steps.length}
									</p>
									<h3 className="mt-1.5 text-lg font-bold tracking-tight text-foreground">{steps[activeStep]?.title}</h3>
									<p className="mt-1 text-xs leading-5 text-muted-foreground">{steps[activeStep]?.description}</p>
								</m.article>

								<div className="min-h-0 overflow-y-auto pb-2">
									<FlowUI activeStep={activeStep} isVisible={isSectionVisible} isCompact />
								</div>
							</div>
						</div>

						<div className="mt-3">
							{steps.map((step, index) => (
								<div
									key={`mobile-tracker-${step.title}`}
									ref={(node) => setStepRef(index, node)}
									data-step-index={index}
									className="h-[72svh]"
									aria-hidden
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</section>
		</LazyMotion>
	);
}
