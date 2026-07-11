"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, m } from "framer-motion";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	BlueprintMock,
	CompleteMock,
	DeployProgressMock,
	ScanResultsMock,
	SetupMock,
} from "@/components/landing/DemoWorkspaceMocks";
import {
	DEMO_REPOS,
	buildDemoRepoFromSlug,
	buildDemoStoryContext,
	type DemoRepo,
} from "@/lib/landing/demoRepos";
import {
	DEPLOY_ANIMATION_MS,
	DEPLOY_LOG_LINES,
	getDeployLogIndex,
	type DemoPhase,
} from "@/lib/landing/interactiveDemo";
import { formatLandingCount } from "@/lib/landing/landingCopy";
import { SCAN_LOG_COUNT, SCAN_STREAM_TOTAL_MS } from "@/lib/landing/scanTimeline";
import { BLUEPRINT_STAGE_COUNT, BLUEPRINT_STAGE_STEP_MS } from "@/lib/landing/blueprint";
import { useAnimatedNumber } from "@/lib/landing/useAnimatedNumber";
import type { LandingPublicStats } from "@/lib/metrics/landingStats";

type InteractiveDeployDemoProps = {
	primaryHref: string;
	primaryCopy: string;
	publicStats: LandingPublicStats | null;
	prefersReducedMotion: boolean | null;
	onPhaseChange: (phase: DemoPhase) => void;
	initialRepoSlug: string | null;
	onRepoChange: (slug: string) => void;
	compact: boolean;
};

type WorkspacePhase = Exclude<DemoPhase, "idle">;

const PHASE_ORDER: ReadonlyArray<WorkspacePhase> = ["setup", "scan", "blueprint", "deploy", "complete"];

const PHASE_LABELS: Record<WorkspacePhase, string> = {
	setup: "Setup",
	scan: "Smart Analysis",
	blueprint: "Blueprint",
	deploy: "Deploy",
	complete: "Complete",
};

const DEMO_LAYOUT = {
	stage: { default: "h-[300px]" },
	stat: { default: "mt-4 h-6" },
	repoPicker: { default: "mt-5 h-8" },
	actions: { default: "mt-5 h-11" },
} as const;

function formatAnalysisStat(count: number): string {
	return `${formatLandingCount(count)} analyses run on real repos so far`;
}

function formatDeploymentStat(count: number): string {
	return `${formatLandingCount(count)} deployments shipped through this flow so far`;
}

export function InteractiveDeployDemo({
	primaryHref,
	primaryCopy,
	publicStats,
	prefersReducedMotion,
	onPhaseChange,
	initialRepoSlug,
	onRepoChange,
	compact,
}: InteractiveDeployDemoProps) {
	const reducedMotion = Boolean(prefersReducedMotion);
	const [repo, setRepo] = React.useState<DemoRepo>(() =>
		initialRepoSlug ? buildDemoRepoFromSlug(initialRepoSlug) : DEMO_REPOS[0]
	);
	const [phase, setPhase] = React.useState<WorkspacePhase>("setup");
	const [scanStarted, setScanStarted] = React.useState(false);
	const [deployStarted, setDeployStarted] = React.useState(false);
	const [deployProgress, setDeployProgress] = React.useState(0);
	const [deployLineCount, setDeployLineCount] = React.useState(0);

	const deployFrameRef = React.useRef<number | null>(null);
	const deployStartRef = React.useRef<number | null>(null);
	const advanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	const storyContext = React.useMemo(() => buildDemoStoryContext(repo), [repo]);

	React.useEffect(() => {
		onPhaseChange(phase);
	}, [onPhaseChange, phase]);

	const clearAdvanceTimer = React.useCallback(() => {
		if (advanceTimerRef.current !== null) {
			clearTimeout(advanceTimerRef.current);
			advanceTimerRef.current = null;
		}
	}, []);

	const scanVisibleLines = useAnimatedNumber({
		to: SCAN_LOG_COUNT,
		durationMs: SCAN_STREAM_TOTAL_MS,
		enabled: phase === "scan" && scanStarted,
		reducedMotion,
		round: true,
		ease: "linear",
		onComplete: React.useCallback(() => {
			clearAdvanceTimer();
			advanceTimerRef.current = setTimeout(() => setPhase("blueprint"), reducedMotion ? 0 : 850);
		}, [clearAdvanceTimer, reducedMotion]),
	});

	const blueprintResolved = useAnimatedNumber({
		to: BLUEPRINT_STAGE_COUNT,
		durationMs: BLUEPRINT_STAGE_COUNT * BLUEPRINT_STAGE_STEP_MS,
		enabled: phase === "blueprint",
		reducedMotion,
		round: true,
		ease: "linear",
		onComplete: React.useCallback(() => {}, []),
	});

	React.useEffect(() => {
		if (phase !== "deploy" || !deployStarted) return;

		if (reducedMotion) {
			const frame = requestAnimationFrame(() => {
				setDeployProgress(100);
				setDeployLineCount(DEPLOY_LOG_LINES.length);
				setPhase("complete");
				setDeployStarted(false);
			});
			return () => cancelAnimationFrame(frame);
		}

		const tick = (now: number) => {
			if (deployStartRef.current === null) deployStartRef.current = now;
			const elapsed = now - deployStartRef.current;
			const progress = Math.min(100, (elapsed / DEPLOY_ANIMATION_MS) * 100);
			const lineCount = getDeployLogIndex(elapsed, DEPLOY_ANIMATION_MS, DEPLOY_LOG_LINES.length);

			if (elapsed >= DEPLOY_ANIMATION_MS) {
				setDeployProgress(100);
				setDeployLineCount(DEPLOY_LOG_LINES.length);
				setPhase("complete");
				setDeployStarted(false);
				deployStartRef.current = null;
				deployFrameRef.current = null;
				return;
			}

			setDeployProgress(progress);
			setDeployLineCount(lineCount);
			deployFrameRef.current = requestAnimationFrame(tick);
		};

		deployFrameRef.current = requestAnimationFrame(tick);
		return () => {
			if (deployFrameRef.current !== null) cancelAnimationFrame(deployFrameRef.current);
			deployFrameRef.current = null;
			deployStartRef.current = null;
		};
	}, [phase, deployStarted, reducedMotion]);

	React.useEffect(() => clearAdvanceTimer, [clearAdvanceTimer]);

	const resetRuntime = React.useCallback(() => {
		clearAdvanceTimer();
		setScanStarted(false);
		setDeployStarted(false);
		setDeployProgress(0);
		setDeployLineCount(0);
	}, [clearAdvanceTimer]);

	const selectRepo = React.useCallback(
		(nextRepo: DemoRepo) => {
			resetRuntime();
			setRepo(nextRepo);
			setPhase("setup");
			onRepoChange(nextRepo.slug);
		},
		[onRepoChange, resetRuntime]
	);

	const runAnalysis = React.useCallback(() => {
		resetRuntime();
		setScanStarted(true);
		setPhase("scan");
	}, [resetRuntime]);

	const approveDeploy = React.useCallback(() => {
		clearAdvanceTimer();
		deployStartRef.current = null;
		setDeployProgress(0);
		setDeployLineCount(1);
		setDeployStarted(true);
		setPhase("deploy");
	}, [clearAdvanceTimer]);

	const replay = React.useCallback(() => {
		resetRuntime();
		setPhase("setup");
	}, [resetRuntime]);

	const handleKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "Enter") return;
			const target = event.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "BUTTON") return;
			if (phase === "setup") {
				event.preventDefault();
				runAnalysis();
			} else if (phase === "blueprint") {
				event.preventDefault();
				approveDeploy();
			} else if (phase === "complete") {
				event.preventDefault();
				replay();
			}
		},
		[approveDeploy, phase, replay, runAnalysis]
	);

	const analysisStat =
		publicStats && publicStats.totalAnalyses > 0
			? formatAnalysisStat(publicStats.totalAnalyses)
			: "Smart Analysis runs on real repositories, every commit";

	const deploymentStat =
		publicStats && publicStats.totalDeployments > 0
			? formatDeploymentStat(publicStats.totalDeployments)
			: "Ship your next deployment with full blueprint visibility";

	const currentIndex = PHASE_ORDER.indexOf(phase);
	const scanComplete = scanVisibleLines >= SCAN_LOG_COUNT;
	const stageHeight = compact ? "demo-stage" : DEMO_LAYOUT.stage.default;

	return (
		<div
			className="w-full"
			data-testid="landing-v2-workspace"
			onKeyDown={handleKeyDown}
			role="group"
			aria-label="Interactive deploy demo"
			tabIndex={-1}
		>
			<div className={compact ? "demo-stepper flex justify-center" : "mb-4 flex justify-center"}>
				<div className={`flex flex-wrap justify-center ${compact ? "" : "gap-1.5"}`} aria-hidden>
					{PHASE_ORDER.map((step, stepIndex) => {
						const isActive = phase === step;
						const isDone = stepIndex < currentIndex;
						return (
							<span
								key={step}
								className={`rounded-[3px] border font-mono uppercase tracking-[0.14em] transition-colors ${
									compact ? "demo-stepper-pill" : "px-2 py-1 text-[10px]"
								} ${
									isActive
										? "border-primary/50 bg-primary/12 text-primary"
										: isDone
											? "border-primary/25 bg-transparent text-primary/70"
											: "border-border bg-transparent text-muted-foreground/70"
								}`}
							>
								{PHASE_LABELS[step]}
							</span>
						);
					})}
				</div>
			</div>

			<div
				className={`landing-panel landing-shell bp-frame w-full ${compact ? "demo-panel-pad" : "p-4 sm:p-5"}`}
			>
				<div className="landing-grid-overlay pointer-events-none absolute inset-0 opacity-10" aria-hidden />
				<div className="relative z-10">
					<div className={`relative overflow-hidden ${stageHeight}`}>
						<AnimatePresence mode="wait">
							<m.div
								key={phase === "scan" ? "scan" : phase}
								initial={reducedMotion ? false : { opacity: 0, y: 10 }}
								animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
								exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
								transition={{ duration: 0.3, ease: "easeOut" }}
								className="absolute inset-0 overflow-hidden"
							>
								{phase === "setup" && <SetupMock context={storyContext} compact={compact} />}
								{phase === "scan" && (
									<ScanResultsMock context={storyContext} visibleLineCount={scanVisibleLines} compact={compact} />
								)}
								{phase === "blueprint" && <BlueprintMock resolvedCount={blueprintResolved} compact={compact} />}
								{phase === "deploy" && (
									<DeployProgressMock
										visibleLineCount={deployLineCount}
										progress={deployProgress}
										compact={compact}
									/>
								)}
								{phase === "complete" && <CompleteMock context={storyContext} compact={compact} />}
							</m.div>
						</AnimatePresence>
					</div>

					<div
						className={`flex items-center justify-center overflow-hidden text-center ${
							compact ? "demo-stat-slot" : DEMO_LAYOUT.stat.default
						}`}
					>
						{phase === "scan" && scanComplete && (
							<p
								className={`truncate text-muted-foreground ${compact ? "demo-text-body" : "text-[13px]"}`}
								data-testid="landing-v2-analysis-stat"
							>
								{analysisStat}
							</p>
						)}
						{phase === "complete" && (
							<p
								className={`truncate font-medium text-foreground ${compact ? "demo-text-body" : "text-[13px]"}`}
								data-testid="landing-v2-deployment-stat"
							>
								{deploymentStat}
							</p>
						)}
					</div>

					<div
						className={`flex items-center gap-1.5 ${
							compact ? "demo-repo-slot" : "mt-5 h-8 flex-nowrap overflow-hidden"
						}`}
					>
						{phase === "setup" && (
							<>
								<span
									className={`mr-1 shrink-0 font-medium text-muted-foreground ${compact ? "demo-text-mono" : "text-[11px]"}`}
								>
									Try a repo:
								</span>
								{DEMO_REPOS.map((demoRepo) => (
									<button
										key={demoRepo.slug}
										type="button"
										onClick={() => selectRepo(demoRepo)}
										className={`shrink-0 rounded-md border font-mono transition-colors ${
											compact ? "demo-repo-chip" : "px-2 py-1 text-[11px]"
										} ${
											demoRepo.slug === repo.slug
												? "border-primary/45 bg-primary/12 text-primary"
												: "border-white/12 bg-white/4 text-white/70 hover:border-white/25"
										}`}
									>
										{demoRepo.label}
									</button>
								))}
							</>
						)}
					</div>

					<div
						className={`flex flex-nowrap items-center justify-center overflow-hidden ${
							compact ? "demo-actions-slot gap-[var(--demo-gap)]" : `${DEMO_LAYOUT.actions.default} flex-wrap gap-3`
						}`}
					>
						{phase === "setup" && (
							<Button
								size={compact ? "default" : "lg"}
								onClick={runAnalysis}
								data-testid="landing-v2-run-analysis"
								className={compact ? "demo-btn shrink-0 gap-1.5" : "gap-2"}
							>
								Run Smart Analysis
								<ArrowRight className={compact ? undefined : "size-4"} />
							</Button>
						)}
						{phase === "scan" && (
							<Button
								size={compact ? "default" : "lg"}
								variant="outline"
								onClick={() => setPhase("blueprint")}
								data-testid="landing-v2-continue-scan"
								className={compact ? "demo-btn shrink-0" : undefined}
							>
								{scanComplete ? "Review blueprint" : "Skip to blueprint"}
							</Button>
						)}
						{phase === "blueprint" && (
							<Button
								size={compact ? "default" : "lg"}
								onClick={approveDeploy}
								data-testid="landing-v2-approve-blueprint"
								className={compact ? "demo-btn shrink-0 gap-1.5" : "gap-2"}
							>
								Approve &amp; deploy
								<ArrowRight className={compact ? undefined : "size-4"} />
							</Button>
						)}
						{phase === "complete" && (
							<>
								<Button
									size={compact ? "default" : "lg"}
									variant="outline"
									onClick={replay}
									className={compact ? "demo-btn shrink-0 gap-1.5" : "gap-2"}
									data-testid="landing-v2-replay"
								>
									<RotateCcw className={compact ? undefined : "size-4"} />
									Replay demo
								</Button>
								<Button
									asChild
									size={compact ? "default" : "lg"}
									className={compact ? "demo-btn shrink-0 gap-1.5" : "gap-2"}
									data-testid="landing-v2-final-cta"
								>
									<Link href={primaryHref}>
										{primaryCopy}
										<ArrowRight className={compact ? undefined : "size-4"} />
									</Link>
								</Button>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
