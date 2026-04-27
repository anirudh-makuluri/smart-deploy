"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CheckCircle2, Circle, Loader2, Terminal, XCircle } from "lucide-react";

type Step = {
	title: string;
	description: string;
};

type NodeId = "repo" | "build" | "deploy" | "live";
type NodeState = "idle" | "active" | "error" | "success";

type LogEntry = {
	id: number;
	text: string;
	tone?: "default" | "error" | "success";
	phase?: "setup" | "scan" | "preview" | "deploy" | "fix" | "live";
};

type StoryContext = {
	serviceLabel: string;
	repoUrl: string;
	repoSlug: string;
	defaultBranch: string;
	releaseBranch: string;
	instanceType: string;
	region: string;
	customDomain: string;
	envSecrets: number;
	instanceIp: string;
	deploymentTarget: string;
};

const steps: Step[] = [
	{ title: "Connect your repo", description: "Link GitHub and pick the branch to deploy." },
	{ title: "We scan your project", description: "We generate build files and validate your setup." },
	{ title: "Preview your deployment", description: "A ready-to-share preview environment is prepared." },
	{ title: "Something fails", description: "A deployment check fails and blocks rollout." },
	{ title: "AI fixes the issue", description: "AI patches the issue and retries safely." },
	{ title: "Your app is live", description: "Traffic is shifted to a healthy production release." },
];

const scanProgressMessages = [
	"Generating Dockerfile...",
	"Dockerfile ready [ok]",
	"Creating docker-compose...",
	"Compose ready [ok]",
	"Running verifier...",
	"Verification complete [ok]",
];

const scanLogMessages = [
	"[scan] reading package.json",
	"[scan] detected Next.js application",
	"[scan] Dockerfile generated",
	"[scan] docker-compose.yml generated",
	"[scan] nginx config prepared",
	"[scan] security checks passed",
];

const storyContext: StoryContext = {
	serviceLabel: "api@smart-deploy",
	repoUrl: "https://github.com/aniru/smart-deploy",
	repoSlug: "aniru/smart-deploy",
	defaultBranch: "main",
	releaseBranch: "release/v1.4",
	instanceType: "t3.small",
	region: "us-west-2",
	customDomain: "my-app.smart-deploy.xyz",
	envSecrets: 3,
	instanceIp: "34.219.22.101",
	deploymentTarget: "AWS / EC2",
};

const setupBranchOptions = [storyContext.defaultBranch, "develop", storyContext.releaseBranch];
const scanFrameCount = scanProgressMessages.length + 1;
const scanTickIntervalMs = 950;
const scanLogIntervalMs = 650;
const scanWorkflowNodes = [
	{ id: "scanner", label: "Scanner", desc: "Repository mapping" },
	{ id: "planner", label: "Planner", desc: "Execution strategy" },
	{ id: "docker_gen", label: "Docker Generator", desc: "Build layers" },
	{ id: "compose_gen", label: "Compose Generator", desc: "Service orchestration" },
	{ id: "nginx_gen", label: "Nginx Generator", desc: "Routing and proxy setup" },
	{ id: "verifier", label: "Verifier", desc: "Final validation" },
];
const previewStages = [
	{
		id: "auth",
		label: "Resolve ref",
		artifacts: [
			{ title: "Repository", subtitle: `github.com/${storyContext.repoSlug}` },
			{ title: "Branch", subtitle: storyContext.releaseBranch },
		],
	},
	{
		id: "build",
		label: "Build images",
		artifacts: [
			{ title: "docker-compose.yml", subtitle: "multi-service build" },
			{ title: "Dockerfiles", subtitle: "2 generated" },
		],
	},
	{
		id: "setup",
		label: "Provision infra",
		artifacts: [
			{ title: "AWS Region", subtitle: storyContext.region },
			{ title: "Instance", subtitle: storyContext.instanceType },
		],
	},
	{
		id: "deploy",
		label: "Deploy + route",
		artifacts: [
			{ title: "Environment", subtitle: `${storyContext.envSecrets} keys injected` },
			{ title: "nginx.conf", subtitle: "routing ready" },
		],
	},
	{
		id: "done",
		label: "Publish domain",
		artifacts: [
			{ title: "Live URL", subtitle: storyContext.customDomain },
			{ title: "DNS", subtitle: "configured" },
		],
	},
];

const workspaceTabs = [
	{ id: "overview", label: "Overview" },
	{ id: "setup", label: "Setup" },
	{ id: "scan", label: "Scan" },
	{ id: "preview", label: "Preview" },
	{ id: "logs", label: "Logs" },
	{ id: "history", label: "History" },
];

const nodePalette: Record<NodeState, { bg: string; border: string; text: string }> = {
	idle: {
		bg: "var(--card)",
		border: "color-mix(in srgb, var(--border) 92%, transparent)",
		text: "var(--muted-foreground)",
	},
	active: {
		bg: "color-mix(in srgb, var(--primary) 11%, var(--card))",
		border: "color-mix(in srgb, var(--primary) 46%, var(--border))",
		text: "var(--primary)",
	},
	error: {
		bg: "color-mix(in srgb, var(--destructive) 10%, var(--card))",
		border: "color-mix(in srgb, var(--destructive) 44%, var(--border))",
		text: "var(--destructive)",
	},
	success: {
		bg: "color-mix(in srgb, var(--accent) 12%, var(--card))",
		border: "color-mix(in srgb, var(--accent) 45%, var(--border))",
		text: "var(--accent)",
	},
};

function getNodeStates(activeStep: number, fixComplete: boolean): Record<NodeId, NodeState> {
	const states: Record<NodeId, NodeState> = {
		repo: "idle",
		build: "idle",
		deploy: "idle",
		live: "idle",
	};

	if (activeStep === 0) states.repo = "active";
	if (activeStep > 0) states.repo = "success";

	if (activeStep === 1) states.build = "active";
	if (activeStep > 1) states.build = "success";

	if (activeStep === 2) states.deploy = "active";
	if (activeStep === 3) states.deploy = "error";
	if (activeStep === 4) states.deploy = fixComplete ? "success" : "error";
	if (activeStep > 4) states.deploy = "success";

	if (activeStep === 5) states.live = "success";

	return states;
}

function getConnectorColor(state: NodeState): string {
	if (state === "success") return "var(--accent)";
	if (state === "active") return "var(--primary)";
	if (state === "error") return "var(--destructive)";
	return "var(--border)";
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
	return (
		<div
			ref={(node) => onRef(index, node)}
			data-step-index={index}
			className="flex h-[60vh] items-center py-6 sm:h-[68vh] sm:py-8 lg:h-[75vh]"
		>
			<motion.article
				layout
				animate={{ opacity: isActive ? 1 : 0.55, y: isActive ? 0 : 8 }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				className={`landing-panel landing-shell w-full rounded-2xl border p-6 sm:p-8 ${
					isActive ? "border-border/75 bg-card/90 shadow-sm" : "border-border/55 bg-background/60"
				}`}
			>
				<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
					Step {index + 1}
				</p>
				<h3 className="mt-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{step.title}</h3>
				<p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
			</motion.article>
		</div>
	);
}

function LogsPanel({ logs }: { logs: LogEntry[] }) {
	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Logs</p>
			<motion.ul layout className="mt-2 space-y-1.5">
				<AnimatePresence initial={false}>
					{logs.map((log) => (
						<motion.li
							key={log.id}
							layout
							initial={{ opacity: 0, y: 12 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
							className={`rounded-md border px-2 py-1.5 text-xs ${
								log.tone === "error"
									? "border-destructive/30 bg-destructive/10 text-destructive"
									: log.tone === "success"
										? "border-primary/35 bg-primary/10 text-primary"
										: "border-border/65 bg-card/75 text-muted-foreground"
							}`}
						>
							{log.text}
						</motion.li>
					))}
				</AnimatePresence>
			</motion.ul>
		</div>
	);
}

function ScanTerminalViewMock({ activeLine, logs }: { activeLine: number; logs: LogEntry[] }) {
	const isScanComplete = activeLine >= scanWorkflowNodes.length;
	const activeNodeIndex = Math.min(activeLine, scanWorkflowNodes.length - 1);
	const progress = isScanComplete ? 100 : Math.round(((activeNodeIndex + 1) / scanWorkflowNodes.length) * 100);
	const activeLineLabel = isScanComplete
		? "Verification complete [ok]"
		: scanProgressMessages[activeLine] ?? scanProgressMessages[0];

	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="mb-3 flex items-start gap-2.5">
				<div className="rounded-md bg-primary/10 p-1.5">
					<Terminal className="size-3.5 text-primary" />
				</div>
				<div>
					<p className="text-xs font-semibold text-foreground">Analysis in Progress</p>
					<p className="text-[11px] text-muted-foreground">SmartDeploy is orchestrating scan nodes</p>
				</div>
			</div>

			<div className="grid gap-3 md:grid-cols-[0.95fr_1.05fr]">
				<div className="space-y-2">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workflow chain</p>
					<div className="space-y-1.5">
						{scanWorkflowNodes.map((node, index) => {
							const isCompleted = isScanComplete ? index <= activeNodeIndex : index < activeNodeIndex;
							const isActive = !isScanComplete && index === activeNodeIndex;
							return (
								<motion.div
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
								</motion.div>
							);
						})}
					</div>
				</div>

				<div className="flex min-h-0 flex-col">
					<div className="mb-1.5 flex items-center justify-between">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Analysis stream</p>
						<div className="flex items-center gap-1.5">
							<span className="relative flex size-2">
								<span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/80" />
								<span className="relative inline-flex size-2 rounded-full bg-primary" />
							</span>
							<span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Live</span>
						</div>
					</div>

					<div className="overflow-hidden rounded-md border border-[#1e1e1e] bg-[#0d0d0d]">
						<motion.ul layout className="max-h-44 min-h-36 space-y-1 overflow-hidden p-2 font-mono text-[10px]">
							<AnimatePresence initial={false}>
								{logs.map((log) => (
									<motion.li
										key={log.id}
										layout
										initial={{ opacity: 0, y: 8 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.18, ease: "easeOut" }}
										className={
											log.text.includes("[scan]")
												? "text-violet-300"
												: log.tone === "error"
													? "text-rose-300"
													: log.tone === "success"
														? "text-emerald-300"
														: "text-slate-300"
										}
									>
										{log.text}
									</motion.li>
								))}
							</AnimatePresence>
						</motion.ul>

						<div className="border-t border-[#1e1e1e] bg-[#0a0a0a] px-2 py-2">
							<div className="mb-1 flex items-center justify-between">
								<span className="text-[10px] text-slate-400">{activeLineLabel}</span>
								<span className="font-mono text-[10px] text-slate-200">{progress}%</span>
							</div>
							<div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
								<motion.div
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

function SetupViewMock({
	selectedBranch,
	onSelectedBranchChange,
	isVisible,
}: {
	selectedBranch: string;
	onSelectedBranchChange: (branch: string) => void;
	isVisible: boolean;
}) {
	const [branchOpen, setBranchOpen] = React.useState(false);
	const [isDemoRunning, setIsDemoRunning] = React.useState(true);

	React.useEffect(() => {
		if (!isVisible || !isDemoRunning) return;

		let cancelled = false;
		const openDelayMs = 700;
		const switchDelayMs = 1900;
		const closeDelayMs = 3000;
		const cycleDurationMs = 4600;
		const activeTimers: number[] = [];

		const runCycle = () => {
			if (cancelled) return;
			setBranchOpen(false);

			activeTimers.push(
				window.setTimeout(() => {
					if (!cancelled) setBranchOpen(true);
				}, openDelayMs)
			);

			activeTimers.push(
				window.setTimeout(() => {
					if (!cancelled) {
						onSelectedBranchChange(
							selectedBranch === setupBranchOptions[0] ? setupBranchOptions[2] : setupBranchOptions[0]
						);
					}
				}, switchDelayMs)
			);

			activeTimers.push(
				window.setTimeout(() => {
					if (!cancelled) setBranchOpen(false);
				}, closeDelayMs)
			);
		};

		runCycle();
		const intervalId = window.setInterval(runCycle, cycleDurationMs);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
			for (const timerId of activeTimers) {
				window.clearTimeout(timerId);
			}
		};
	}, [isDemoRunning, isVisible, onSelectedBranchChange, selectedBranch]);

	React.useEffect(() => {
		if (!isVisible) {
			setBranchOpen(false);
		}
	}, [isVisible]);

	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="space-y-2.5">
				<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Project source</p>
					<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
						<p className="text-xs font-medium text-foreground">{storyContext.serviceLabel}</p>
						<p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{storyContext.repoUrl}</p>
					</div>
				</div>
				<div className="grid gap-2 sm:grid-cols-2">
					<div
						className="rounded-lg border border-border/60 bg-card/70 p-2.5"
						onFocusCapture={() => setIsDemoRunning(false)}
						onPointerDown={() => setIsDemoRunning(false)}
					>
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Deployment branch</p>
						<div className="relative mt-2">
							<motion.button
								type="button"
								onClick={() => setBranchOpen((previous) => !previous)}
								className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs text-foreground"
								whileTap={{ scale: 0.99 }}
							>
								<span>{selectedBranch}</span>
								<motion.span
									animate={{ rotate: branchOpen ? 180 : 0 }}
									transition={{ duration: 0.18, ease: "easeOut" }}
									className="text-[10px] text-muted-foreground"
								>
									v
								</motion.span>
							</motion.button>
							<AnimatePresence>
								{branchOpen ? (
									<motion.ul
										initial={{ opacity: 0, y: -6, height: 0 }}
										animate={{ opacity: 1, y: 0, height: "auto" }}
										exit={{ opacity: 0, y: -4, height: 0 }}
										transition={{ duration: 0.18, ease: "easeOut" }}
										className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border/65 bg-card/95 shadow-md"
									>
										{setupBranchOptions.map((branch) => (
											<motion.li
												key={branch}
												layout
												onClick={() => {
													onSelectedBranchChange(branch);
													setBranchOpen(false);
												}}
												className={`cursor-pointer px-2 py-1.5 text-xs transition-colors ${
													branch === selectedBranch
														? "bg-primary/10 text-primary"
														: "text-foreground hover:bg-muted/60"
												}`}
											>
												{branch}
											</motion.li>
										))}
									</motion.ul>
								) : null}
							</AnimatePresence>
						</div>
					</div>
					<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">EC2 instance</p>
						<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
							<p className="text-xs text-foreground">{storyContext.instanceType}</p>
							<p className="mt-0.5 text-[10px] text-muted-foreground">$0.0208/hr (on-demand)</p>
						</div>
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Custom domain</p>
					<div className="mt-2 flex items-center gap-2">
						<div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
							https://{storyContext.customDomain}
						</div>
						<span className="rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
							Save
						</span>
					</div>
				</div>
				<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Environment variables</p>
					<div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5">
						<p className="text-xs text-foreground">{`${storyContext.envSecrets} Secret Keys`}</p>
						<span className="rounded-md border border-border/65 bg-card px-2 py-1 text-[10px] text-muted-foreground">Edit</span>
					</div>
				</div>
			</div>
		</div>
	);
}
function PreviewViewMock({ selectedBranch }: { selectedBranch: string }) {
	return (
		<div className="rounded-xl border border-border/65 bg-background/70 p-3">
			<div className="rounded-lg border border-border/60 bg-card/70 p-2.5">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
					Preview | AWS CodeBuild -&gt; EC2
				</p>
				<p className="mt-1 text-xs font-semibold text-foreground">What runs in each stage of this deploy</p>
				<p className="mt-1 text-[11px] text-muted-foreground">
					Pipeline runs left to right; each stage shows the config and artifacts it uses.
				</p>
			</div>
			<div className="mt-3 overflow-x-auto pb-1">
				<div className="min-w-[540px] sm:min-w-[760px]">
					<div className="flex items-center">
						{previewStages.map((stage, index) => (
							<React.Fragment key={stage.id}>
								<motion.div
									layout
									className="w-[102px] rounded-lg border border-border/60 bg-card/75 px-2 py-2 sm:w-[142px]"
								>
									<div className="flex items-start justify-between gap-1.5">
										<div>
											<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{stage.id}</p>
											<p className="mt-0.5 text-xs font-medium text-foreground">{stage.label}</p>
										</div>
										<span className="rounded-full border border-primary/35 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
											OK
										</span>
									</div>
								</motion.div>
								{index < previewStages.length - 1 ? <div className="h-px w-3 shrink-0 bg-border/80 sm:w-5" /> : null}
							</React.Fragment>
						))}
					</div>
					<div className="mt-2.5 flex items-start">
						{previewStages.map((stage, index) => {
							const artifacts =
								stage.id === "auth"
									? stage.artifacts.map((artifact) =>
											artifact.title === "Branch" ? { ...artifact, subtitle: selectedBranch } : artifact
									)
									: stage.artifacts;
							return (
								<React.Fragment key={`${stage.id}-artifacts`}>
									<div className="flex w-[102px] flex-col gap-1.5 sm:w-[142px]">
										{artifacts.map((artifact) => (
											<motion.div
												key={`${stage.id}-${artifact.title}`}
												layout
												className="rounded-md border border-border/60 bg-background/75 px-2 py-1.5"
											>
												<p className="truncate text-[10px] font-medium text-muted-foreground">{artifact.title}</p>
												<p className="truncate font-mono text-[10px] text-foreground">{artifact.subtitle}</p>
											</motion.div>
										))}
									</div>
									{index < previewStages.length - 1 ? <div className="w-3 shrink-0 sm:w-5" /> : null}
								</React.Fragment>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
function DeployFailureViewMock({ logs }: { logs: LogEntry[] }) {
	const deploySteps = [
		{ id: "auth", status: "success" },
		{ id: "build", status: "success" },
		{ id: "setup", status: "success" },
		{ id: "deploy", status: "error" },
		{ id: "done", status: "idle" },
	] as const;
	const completedSteps = deploySteps.filter((step) => step.status === "success").length;
	const progress = Math.round((completedSteps / deploySteps.length) * 100);

	return (
		<div className="space-y-3">
			<div className="relative overflow-hidden rounded-xl border border-border/65 bg-background/70 p-3">
				<div className="absolute inset-x-0 top-0 h-[2px] bg-border/40" aria-hidden>
					<div className="h-full bg-destructive transition-all duration-700" style={{ width: `${progress}%` }} />
				</div>

				<div className="flex items-start justify-between gap-3 pt-1">
					<div className="flex items-start gap-2.5">
						<div className="rounded-lg bg-destructive/12 p-1.5 text-destructive">
							<XCircle className="size-4" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">Deployment Failed</p>
							<p className="text-[11px] text-muted-foreground">An error occurred during deployment (step 4 of 5)</p>
						</div>
					</div>

					<div className="flex items-center gap-1.5 pt-1">
						{deploySteps.map((step) => (
							<span
								key={step.id}
								className={`size-2 rounded-full ${
									step.status === "success"
										? "bg-accent"
										: step.status === "error"
											? "bg-destructive shadow-[0_0_8px_color-mix(in_srgb,var(--destructive)_45%,transparent)]"
											: "bg-border"
								}`}
								title={step.id}
							/>
						))}
					</div>
				</div>
			</div>

			<div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5">
				<p className="text-xs font-semibold text-destructive">Deployment failed</p>
				<p className="mt-1 text-[11px] text-muted-foreground">Health check `/api/health` returned non-200. Verify container port mapping and service startup command.</p>
			</div>

			<div className="overflow-hidden rounded-xl border border-[#1e1e1e] bg-[#0d0d0d]">
				<div className="border-b border-[#1e1e1e] bg-[#0a0a0a] px-2 py-1.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Deploy Logs</p>
				</div>
				<motion.ul layout className="min-h-36 space-y-1 overflow-hidden p-2 font-mono text-[10px]">
					<AnimatePresence initial={false}>
						{logs.map((log) => (
							<motion.li
								key={log.id}
								layout
								initial={{ opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.18, ease: "easeOut" }}
								className={
									log.tone === "error"
										? "text-rose-300"
										: log.tone === "success"
											? "text-emerald-300"
											: "text-slate-300"
								}
							>
								{log.text}
							</motion.li>
						))}
					</AnimatePresence>
				</motion.ul>
			</div>
		</div>
	);
}

function AIFixViewMock({ fixComplete, logs }: { fixComplete: boolean; logs: LogEntry[] }) {
	const fixSteps = [
		{ id: "analyze", label: "Analyze failure logs", status: "success" as const },
		{ id: "patch", label: "Patch compose + nginx config", status: fixComplete ? ("success" as const) : ("active" as const) },
		{ id: "retry", label: "Retry deployment + health checks", status: fixComplete ? ("success" as const) : ("idle" as const) },
	];

	return (
		<div className="space-y-3">
			<div className="relative overflow-hidden rounded-xl border border-border/65 bg-background/70 p-3">
				<div className="absolute inset-x-0 top-0 h-[2px] bg-border/40" aria-hidden>
					<div
						className={`h-full transition-all duration-700 ${fixComplete ? "bg-accent" : "bg-primary"}`}
						style={{ width: fixComplete ? "100%" : "72%" }}
					/>
				</div>

				<div className="flex items-start justify-between gap-3 pt-1">
					<div className="flex items-start gap-2.5">
						<div className={`rounded-lg p-1.5 ${fixComplete ? "bg-accent/12 text-accent" : "bg-primary/12 text-primary"}`}>
							{fixComplete ? <CheckCircle2 className="size-4" /> : <Bot className="size-4" />}
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">
								{fixComplete ? "Issue fixed by AI" : "AI fixing issue..."}
							</p>
							<p className="text-[11px] text-muted-foreground">
								{fixComplete
									? "Patch applied and retry completed successfully."
									: "Generating a safe patch from failure signals."}
							</p>
						</div>
					</div>

					<span
						className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
							fixComplete
								? "border-accent/35 bg-accent/10 text-accent"
								: "border-primary/35 bg-primary/10 text-primary"
						}`}
					>
						{fixComplete ? "Recovered" : "In progress"}
					</span>
				</div>
			</div>

			<div className="rounded-xl border border-border/65 bg-background/70 p-3">
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Fix plan</p>
				<div className="mt-2 space-y-1.5">
					{fixSteps.map((step) => (
						<motion.div
							key={step.id}
							layout
							className={`rounded-md border px-2 py-1.5 ${
								step.status === "success"
									? "border-accent/35 bg-accent/10"
									: step.status === "active"
										? "border-primary/35 bg-primary/10"
										: "border-border/60 bg-card/75"
							}`}
						>
							<div className="flex items-center gap-2">
								{step.status === "success" ? (
									<CheckCircle2 className="size-3.5 text-accent" />
								) : step.status === "active" ? (
									<Loader2 className="size-3.5 animate-spin text-primary" />
								) : (
									<Circle className="size-3.5 text-muted-foreground/70" />
								)}
								<p className="text-xs text-foreground">{step.label}</p>
							</div>
						</motion.div>
					))}
				</div>
			</div>

			<div className="overflow-hidden rounded-xl border border-[#1e1e1e] bg-[#0d0d0d]">
				<div className="border-b border-[#1e1e1e] bg-[#0a0a0a] px-2 py-1.5">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">AI Recovery Logs</p>
				</div>
				<motion.ul layout className="min-h-28 space-y-1 overflow-hidden p-2 font-mono text-[10px]">
					<AnimatePresence initial={false}>
						{logs.map((log) => (
							<motion.li
								key={log.id}
								layout
								initial={{ opacity: 0, y: 8 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.18, ease: "easeOut" }}
								className={
									log.tone === "success"
										? "text-emerald-300"
										: "text-slate-300"
								}
							>
								{log.text}
							</motion.li>
						))}
					</AnimatePresence>
				</motion.ul>
			</div>
		</div>
	);
}

function LiveSuccessViewMock() {
	return (
		<div className="space-y-3">
			<div className="relative overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
				<div className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/20 blur-2xl" aria-hidden />
				<div className="relative flex items-start justify-between gap-3">
					<div className="flex items-start gap-2.5">
						<div className="rounded-lg bg-primary/18 p-1.5 text-primary">
							<CheckCircle2 className="size-4" />
						</div>
						<div>
							<p className="text-sm font-semibold text-foreground">Deployment Successful</p>
							<p className="text-[11px] text-muted-foreground">All steps completed. Application is live.</p>
						</div>
					</div>
					<span className="rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
						Live
					</span>
				</div>
			</div>

			<div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
				<div className="rounded-xl border border-border/65 bg-background/70 p-3">
					<div className="flex items-center justify-between border-b border-border/55 pb-2">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Front page preview</p>
						<span className="text-[10px] text-muted-foreground">Live topology</span>
					</div>
					<div className="mt-2 h-32 rounded-lg border border-border/60 bg-card/75 p-2">
						<div className="h-full rounded-md border border-primary/20 bg-gradient-to-br from-primary/10 via-background/75 to-card/70 p-2">
							<div className="mb-1 flex items-center gap-1.5">
								<span className="size-1.5 rounded-full bg-rose-400/80" />
								<span className="size-1.5 rounded-full bg-amber-400/80" />
								<span className="size-1.5 rounded-full bg-emerald-400/80" />
							</div>
							<div className="space-y-1.5">
								<div className="h-2 w-3/4 rounded bg-primary/25" />
								<div className="h-2 w-full rounded bg-border/70" />
								<div className="h-2 w-2/3 rounded bg-border/70" />
								<div className="mt-2 h-6 w-24 rounded-md border border-primary/35 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
									Visit Site
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<div className="rounded-xl border border-border/65 bg-background/70 p-3">
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live URLs & access</p>
						<div className="mt-2 space-y-2 border-t border-border/55 pt-2">
							<div className="flex items-start justify-between gap-2">
								<span className="text-[10px] text-muted-foreground">Custom URL</span>
								<span className="break-all text-right text-xs font-medium text-primary">{storyContext.customDomain}</span>
							</div>
							<div className="flex items-start justify-between gap-2">
								<span className="text-[10px] text-muted-foreground">Instance IP</span>
								<span className="font-mono text-xs text-foreground">{storyContext.instanceIp}</span>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
							<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Environment</p>
							<p className="mt-1 text-xs font-semibold text-foreground">Production</p>
						</div>
						<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
							<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Region</p>
							<p className="mt-1 font-mono text-xs font-semibold text-foreground">us-west-2</p>
						</div>
						<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
							<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Last deploy</p>
							<p className="mt-1 text-xs font-semibold text-foreground">Just now</p>
						</div>
						<div className="rounded-lg border border-border/60 bg-card/75 p-2.5">
							<p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Target</p>
							<p className="mt-1 text-xs font-semibold text-foreground">{storyContext.deploymentTarget}</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function NodeChip({
	label,
	state,
	glow = false,
}: {
	label: string;
	state: NodeState;
	glow?: boolean;
}) {
	const palette = nodePalette[state];

	return (
		<motion.div
			layout
			transition={{ duration: 0.2, ease: "easeOut" }}
			className="rounded-xl border px-2.5 py-1.5 text-center text-xs font-semibold transition-colors sm:px-3 sm:py-2 sm:text-sm"
			style={{
				backgroundColor: palette.bg,
				borderColor: palette.border,
				color: palette.text,
				boxShadow: glow ? "0 0 0 3px color-mix(in srgb, var(--primary) 24%, transparent)" : "0 0 0 0 transparent",
			}}
		>
			{label}
		</motion.div>
	);
}

function FlowUI({ activeStep, isVisible }: { activeStep: number; isVisible: boolean }) {
	const [scanLine, setScanLine] = React.useState(0);
	const [scanLogs, setScanLogs] = React.useState<LogEntry[]>([]);
	const [fixComplete, setFixComplete] = React.useState(false);
	const [selectedBranch, setSelectedBranch] = React.useState(storyContext.defaultBranch);
	const nextLogId = React.useRef(0);

	React.useEffect(() => {
		if (!isVisible) {
			return;
		}
		if (activeStep === 0) {
			setScanLine(0);
			return;
		}
		if (activeStep > 1) {
			setScanLine(scanFrameCount - 1);
			return;
		}
		const interval = window.setInterval(() => {
			setScanLine((prev) => (prev + 1) % scanFrameCount);
		}, scanTickIntervalMs);
		return () => window.clearInterval(interval);
	}, [activeStep, isVisible]);

	React.useEffect(() => {
		if (!isVisible) {
			return;
		}
		if (activeStep === 0) {
			setScanLogs([]);
			return;
		}
		if (activeStep !== 1) {
			return;
		}

		setScanLogs((previous) => {
			if (previous.length > 0) return previous;
			nextLogId.current += 1;
			return [{ id: nextLogId.current, text: scanLogMessages[0], phase: "scan" }];
		});

		let cursor = 0;

		const interval = window.setInterval(() => {
			cursor = (cursor + 1) % scanLogMessages.length;
			nextLogId.current += 1;
			setScanLogs((previous) => {
				const next = [...previous, { id: nextLogId.current, text: scanLogMessages[cursor], phase: "scan" as const }];
				return next.slice(-10);
			});
		}, scanLogIntervalMs);

		return () => window.clearInterval(interval);
	}, [activeStep, isVisible]);

	React.useEffect(() => {
		if (!isVisible) {
			return;
		}
		if (activeStep < 4) {
			setFixComplete(false);
			return;
		}
		if (activeStep > 4) {
			setFixComplete(true);
			return;
		}
		setFixComplete(false);
		const timeout = window.setTimeout(() => setFixComplete(true), 900);
		return () => window.clearTimeout(timeout);
	}, [activeStep, isVisible]);

	const activeWorkspaceTab =
		activeStep === 0
			? "setup"
			: activeStep === 1
				? "scan"
				: activeStep === 2
					? "preview"
					: activeStep === 5
						? "overview"
						: "logs";

	const storyTimelineLogs = React.useMemo(() => {
		const timeline: LogEntry[] = [
			{ id: 1000, text: `[setup] repo connected: ${storyContext.repoSlug}`, phase: "setup" },
			{ id: 1001, text: `[setup] branch selected: ${selectedBranch}`, phase: "setup" },
			...scanLogs,
		];

		if (activeStep >= 2) {
			timeline.push({ id: 2000, text: "[preview] pipeline map ready for review", phase: "preview", tone: "success" });
		}
		if (activeStep >= 3) {
			timeline.push(
				{ id: 3000, text: "[deploy] building image layer cache", phase: "deploy" },
				{ id: 3001, text: "[deploy] pushing artifacts to registry", phase: "deploy" },
				{ id: 3002, text: "[deploy] running health checks on /api/health", phase: "deploy", tone: "error" },
				{ id: 3003, text: "[deploy] ERROR: health check failed at /api/health", phase: "deploy", tone: "error" }
			);
		}
		if (activeStep >= 4) {
			timeline.push(
				{ id: 4000, text: "[ai] analyzing deploy logs and config snapshot", phase: "fix" },
				{ id: 4001, text: "[ai] root cause: port mismatch between service and reverse proxy", phase: "fix" },
				{
					id: 4002,
					text: fixComplete
						? "[ai] patch applied to docker-compose and nginx.conf"
						: "[ai] patching docker-compose and nginx.conf...",
					phase: "fix",
					tone: fixComplete ? "success" : "default",
				}
			);
			if (fixComplete) {
				timeline.push({ id: 4003, text: "[deploy] retry passed: /api/health returned 200", phase: "fix", tone: "success" });
			}
		}
		if (activeStep >= 5) {
			timeline.push({ id: 5000, text: `[live] promoted release on ${storyContext.customDomain}`, phase: "live", tone: "success" });
		}

		return timeline;
	}, [activeStep, fixComplete, scanLogs, selectedBranch]);

	const scanViewLogs = storyTimelineLogs.filter((log) => log.phase === "setup" || log.phase === "scan").slice(-8);
	const failureLogs = storyTimelineLogs.filter((log) => log.phase === "scan" || log.phase === "preview" || log.phase === "deploy").slice(-6);
	const aiRecoveryLogs = storyTimelineLogs.filter((log) => log.phase === "deploy" || log.phase === "fix").slice(-6);

	const nodeStates = getNodeStates(activeStep, fixComplete);

	return (
		<div className="landing-panel landing-shell mx-auto w-full max-w-[46rem] rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm sm:p-5">
			<div className="flex hidden items-center justify-between gap-3">
				<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Deployment flow</p>
				<p className="text-xs text-muted-foreground">Step {activeStep + 1} / {steps.length}</p>
			</div>

			<div className="mt-3 rounded-xl border border-border/65 bg-background/70 p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
						<p className="text-xs font-medium text-foreground">{storyContext.serviceLabel}</p>
					</div>
					<div className="text-right text-[10px] text-muted-foreground">
						<p>{selectedBranch}</p>
						<p>{storyContext.deploymentTarget}</p>
					</div>
				</div>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{workspaceTabs.map((tab) => (
						<span
							key={tab.id}
							className={`rounded-md border px-2 py-1 text-[10px] font-medium ${
								tab.id === activeWorkspaceTab
									? "border-primary/35 bg-primary/10 text-primary"
									: "border-border/60 bg-card/70 text-muted-foreground"
							}`}
						>
							{tab.label}
						</span>
					))}
				</div>
			</div>

			<div className="mt-3 overflow-x-auto pb-1">
				<div className="grid min-w-[380px] grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)_14px_minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-1.5 sm:min-w-[540px] sm:grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)_40px_minmax(0,1fr)] sm:gap-2">
					<NodeChip label="Repo" state={nodeStates.repo} />
					<motion.div
						layout
						animate={{ backgroundColor: getConnectorColor(nodeStates.repo) }}
						transition={{ duration: 0.2 }}
						className="h-px w-full rounded-full"
					/>
					<NodeChip label="Build" state={nodeStates.build} />
					<motion.div
						layout
						animate={{ backgroundColor: getConnectorColor(nodeStates.build) }}
						transition={{ duration: 0.2 }}
						className="h-px w-full rounded-full"
					/>
					<NodeChip label="Deploy" state={nodeStates.deploy} />
					<motion.div
						layout
						animate={{ backgroundColor: getConnectorColor(nodeStates.deploy) }}
						transition={{ duration: 0.2 }}
						className="h-px w-full rounded-full"
					/>
					<NodeChip label="Live" state={nodeStates.live} glow={activeStep === 5} />
				</div>
			</div>

			<div className="mt-4 space-y-3 min-[420px]:min-h-[22rem] sm:min-h-[24rem] lg:min-h-[25.5rem]">
				{activeStep === 0 ? (
					<motion.div
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<SetupViewMock
							selectedBranch={selectedBranch}
							onSelectedBranchChange={setSelectedBranch}
							isVisible={isVisible}
						/>
					</motion.div>
				) : null}

				{activeStep === 1 ? <ScanTerminalViewMock activeLine={scanLine} logs={scanViewLogs} /> : null}
				{activeStep === 2 ? (
					<motion.div
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<PreviewViewMock selectedBranch={selectedBranch} />
					</motion.div>
				) : null}
				{activeStep === 3 ? (
					<motion.div
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<DeployFailureViewMock logs={failureLogs} />
					</motion.div>
				) : null}
				{activeStep === 4 ? (
					<motion.div
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<AIFixViewMock fixComplete={fixComplete} logs={aiRecoveryLogs} />
					</motion.div>
				) : null}
				{activeStep === 5 ? (
					<motion.div
						initial={{ opacity: 0, y: 14 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<LiveSuccessViewMock />
					</motion.div>
				) : null}

				<div className="hidden rounded-xl border border-border/65 bg-background/70 p-3">
					<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Story timeline</p>
					<motion.ul layout className="mt-2 space-y-1">
						<AnimatePresence initial={false}>
							{storyTimelineLogs.slice(-5).map((log) => (
								<motion.li
									key={log.id}
									layout
									initial={{ opacity: 0, y: 8 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.18, ease: "easeOut" }}
									className={`rounded-md border px-2 py-1.5 text-[11px] ${
										log.tone === "error"
											? "border-destructive/30 bg-destructive/10 text-destructive"
											: log.tone === "success"
												? "border-primary/35 bg-primary/10 text-primary"
												: "border-border/60 bg-card/75 text-muted-foreground"
									}`}
								>
									{log.text}
								</motion.li>
							))}
						</AnimatePresence>
					</motion.ul>
				</div>
			</div>
		</div>
	);
}

export function ScrollytellingSection() {
	const [activeStep, setActiveStep] = React.useState(0);
	const [isSectionVisible, setIsSectionVisible] = React.useState(false);
	const stepRefs = React.useRef<Array<HTMLDivElement | null>>([]);
	const sectionRef = React.useRef<HTMLElement | null>(null);

	const setStepRef = React.useCallback((index: number, node: HTMLDivElement | null) => {
		stepRefs.current[index] = node;
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
	}, []);

	React.useEffect(() => {
		const sectionNode = sectionRef.current;
		if (!sectionNode) return;

		const visibilityObserver = new IntersectionObserver(
			([entry]) => {
				setIsSectionVisible(entry.isIntersecting && entry.intersectionRatio > 0.12);
			},
			{ threshold: [0, 0.12, 0.3] }
		);

		visibilityObserver.observe(sectionNode);
		return () => visibilityObserver.disconnect();
	}, []);

	return (
		<section
			ref={sectionRef}
			id="flow"
			className="w-full scroll-mt-20 border-t border-border/60 bg-muted/20 px-4 py-16 sm:scroll-mt-24 sm:px-6 sm:py-20 lg:px-10"
		>
			<div className="mx-auto max-w-7xl">
				<div className="mx-auto max-w-3xl text-center">
					<p className="text-xs font-semibold uppercase tracking-[0.26em] text-primary">Full Product Flow</p>
					<h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
						Follow every deploy moment, from first commit to live traffic
					</h2>
					<p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
						One sticky workspace walks you through the full journey: connect your repo, scan and preview, catch failures,
						watch AI fix them, and ship to production with confidence.
					</p>
				</div>

				<div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
					<div>
						{steps.map((step, index) => {
							const stepKey = `${index}-${step.title}`;
							return (
								<React.Fragment key={stepKey}>
									<StepItem
										index={index}
										step={step}
										isActive={activeStep === index}
										onRef={setStepRef}
									/>
									{activeStep === index ? (
										<div className="mb-10 lg:hidden">
											<FlowUI activeStep={activeStep} isVisible={isSectionVisible} />
										</div>
									) : null}
								</React.Fragment>
							);
						})}
					</div>

					<div className="hidden lg:sticky lg:top-20 lg:block lg:h-[calc(100vh-6rem)]">
						<div className="flex h-full items-start justify-center pt-1">
							<FlowUI activeStep={activeStep} isVisible={isSectionVisible} />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
