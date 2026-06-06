"use client";

import * as React from "react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import { buildPreviewModel, type PreviewArtifact, type PreviewStepId } from "@/components/blueprint/preview-model";
import { cn } from "@/lib/utils";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetDescription,
	SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AWS_REGION_OPTIONS } from "@/components/blueprint/blueprint-fields";
import { defaultAwsRegionForDeploy } from "@/lib/deployInfraDefaults";
import { Alert, AlertDescription } from "@/components/ui/alert";
import config from "@/config.client";
import { updateCustomDomain } from "@/lib/graphqlClient";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Globe, RotateCw } from "lucide-react";

const DOMAIN_SUFFIX = config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz";

function mapCustomDomainError(error: unknown): string {
	const message = error instanceof Error ? error.message : "Failed to update custom domain";
	if (message === "Deployment not found") {
		return "This deployment no longer exists. Reopen the service or deploy again before setting a custom domain.";
	}
	return message;
}

type PreviewModeViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
	branchOptions: string[];
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onUpdateScanResults: (updater: (current: SDArtifactsResponse) => SDArtifactsResponse) => Promise<void> | void;
};

type Editor =
	| { kind: "branch" }
	| { kind: "compose" }
	| { kind: "dockerfile"; unitName?: string }
	| { kind: "infra" }
	| { kind: "envVars" }
	| { kind: "nginx" }
	| { kind: "customDomain" }
	| null;

function groupByStep(artifacts: PreviewArtifact[]): Record<PreviewStepId, PreviewArtifact[]> {
	return artifacts.reduce(
		(acc, a) => {
			acc[a.stepId].push(a);
			return acc;
		},
		{ auth: [], build: [], setup: [], deploy: [], done: [] } as Record<PreviewStepId, PreviewArtifact[]>
	);
}

function Port({
	position,
	className,
}: {
	position: "top" | "bottom" | "left" | "right";
	className?: string;
}) {
	const base =
		"pointer-events-none absolute z-20 h-2 w-2.5 rounded-[2px] bg-[var(--port)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
	const pos =
		position === "top"
			? "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2"
			: position === "bottom"
				? "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2"
				: position === "left"
					? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
					: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2";
	return <span aria-hidden className={cn(base, pos, className)} />;
}

function Trunk({ className }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={cn(
				"pointer-events-none w-px shrink-0 bg-gradient-to-b from-white/18 via-white/10 to-white/5",
				className
			)}
		/>
	);
}

export default function PreviewModeView({
	deployment,
	scanResults,
	branchOptions,
	onUpdateDeployment,
	onUpdateScanResults,
}: PreviewModeViewProps) {
	const model = React.useMemo(() => buildPreviewModel({ deployment, scanResults }), [deployment, scanResults]);
	const artifactsByStep = React.useMemo(() => groupByStep(model.artifacts), [model.artifacts]);
	const [editor, setEditor] = React.useState<Editor>(null);

	const customUrlVerifying = false;
	const [customUrlSaving, setCustomUrlSaving] = React.useState(false);
	const [customUrlStatus, setCustomUrlStatus] = React.useState<{
		type: "success" | "error" | null;
		message?: string;
	}>({ type: null });
	const [subdomainDraft, setSubdomainDraft] = React.useState("");

	const initialSubdomain = React.useMemo(() => {
		let raw = deployment.liveUrl;
		if (!raw) return "";
		raw = raw.replace(/^https?:\/\//, "");
		if (raw.endsWith(`.${DOMAIN_SUFFIX}`)) {
			return raw.slice(0, -(DOMAIN_SUFFIX.length + 1));
		}
		return raw.split(".")[0];
	}, [deployment.liveUrl]);

	React.useEffect(() => {
		if (editor?.kind === "customDomain") {
			setSubdomainDraft(initialSubdomain);
			setCustomUrlStatus({ type: null });
		}
	}, [editor?.kind, initialSubdomain]);

	const getCustomUrlFromSubdomain = (subdomain: string) =>
		subdomain.trim() ? `https://${subdomain.trim()}.${DOMAIN_SUFFIX}` : "";

	const isCustomUrlDirty = subdomainDraft !== initialSubdomain;

	const handleSaveCustomUrl = async () => {
		const trimmed = subdomainDraft.trim();
		const finalUrl = getCustomUrlFromSubdomain(trimmed);
		const previousUrl = (deployment.liveUrl || "").trim();
		if (finalUrl === previousUrl) return;

		setCustomUrlSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repoName, deployment.serviceName, finalUrl);
			await onUpdateDeployment({ liveUrl: finalUrl || null });
			setCustomUrlStatus({
				type: finalUrl ? "success" : null,
				message: finalUrl ? data?.message || `Custom domain saved: ${finalUrl}` : undefined,
			});
			if (finalUrl) {
				toast.success(data?.message || "Custom domain saved");
			} else {
				toast.success("Custom domain cleared");
			}
		} catch (error: unknown) {
			const message = mapCustomDomainError(error);
			setCustomUrlStatus({ type: "error", message });
			toast.error(message);
		} finally {
			setCustomUrlSaving(false);
		}
	};

	const handleCancelCustomUrl = () => {
		setSubdomainDraft(initialSubdomain);
		setCustomUrlStatus({ type: null });
	};

	const deployUnits = React.useMemo(() => scanResults?.deploy_units ?? [], [scanResults?.deploy_units]);
	const primaryUnitName = React.useMemo(() => deployUnits[0]?.name, [deployUnits]);
	const selectedUnit = React.useMemo(() => {
		const name = editor?.kind === "dockerfile" ? editor.unitName ?? primaryUnitName : primaryUnitName;
		return deployUnits.find((u) => u.name === name) ?? deployUnits[0];
	}, [deployUnits, editor, primaryUnitName]);
	const railpackPlanJson = React.useMemo(() => {
		const plan = selectedUnit?.artifacts?.railpack_plan;
		if (!plan) return "";
		try {
			return JSON.stringify(plan, null, 2);
		} catch {
			return String(plan);
		}
	}, [selectedUnit]);

	function openArtifact(artifact: PreviewArtifact) {
		switch (artifact.action) {
			case "openBranch":
				setEditor({ kind: "branch" });
				return;
			case "openCompose":
				setEditor({ kind: "compose" });
				return;
			case "openDockerfile":
				setEditor({ kind: "dockerfile", unitName: primaryUnitName });
				return;
			case "openInfra":
				setEditor({ kind: "infra" });
				return;
			case "openEnvVars":
				setEditor({ kind: "envVars" });
				return;
			case "openNginx":
				setEditor({ kind: "nginx" });
				return;
			case "openCustomDomain":
				setEditor({ kind: "customDomain" });
				return;
			default:
				return;
		}
	}

	const warningsByStep = React.useMemo(
		() =>
			model.warnings.reduce(
				(acc, w) => {
					acc[w.stepId].push(w);
					return acc;
				},
				{ auth: [], build: [], setup: [], deploy: [], done: [] } as Record<PreviewStepId, typeof model.warnings>
			),
		[model]
	);

	const regionSelectOptions = React.useMemo(() => {
		const v = (deployment.awsRegion || "").trim() || defaultAwsRegionForDeploy();
		if (AWS_REGION_OPTIONS.some((o) => o.value === v)) return AWS_REGION_OPTIONS;
		return [{ value: v, label: `Other (${v})` }, ...AWS_REGION_OPTIONS];
	}, [deployment.awsRegion]);

	return (
		<div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-1 flex-col gap-5 p-6">
			<div className="rounded-3xl border border-white/6 bg-gradient-to-br from-white/6 via-white/2 to-transparent px-6 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-md">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
							Preview · {model.pipelineLabel}
						</div>
						<div className="mt-1.5 text-base font-semibold tracking-tight text-white">
							What runs in each stage of this deploy
						</div>
						<p className="mt-1 max-w-xl text-sm leading-relaxed text-white/45">
							Pipeline runs left to right; under each stage is the config and files that stage uses. Click a step or a row to edit.
						</p>
					</div>
				</div>
			</div>

			<div className="relative min-h-0 flex-1 overflow-auto rounded-3xl border border-white/6 bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(99,102,241,0.08),transparent_55%),radial-gradient(900px_480px_at_80%_40%,rgba(34,211,238,0.05),transparent_50%),rgba(6,8,14,0.94)] p-6 sm:p-8">
				<div className="dot-grid-bg pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
				<div className="relative flex min-w-0 flex-col gap-8">
					{/* Row 1: horizontal pipeline */}
					<div className="flex w-full min-w-[min(100%,720px)] flex-row items-stretch justify-center gap-0">
						{model.steps.map((step, stepIndex) => {
							const stepArtifacts = artifactsByStep[step.id];
							const stepWarnings = warningsByStep[step.id];
							const hasWarnings = stepWarnings.length > 0;

							const nodeVerb =
								step.id === "auth"
									? "Resolve ref"
									: step.id === "build"
										? model.deployRoute === "static_s3"
											? "Build & sync"
											: "Build images"
										: step.id === "setup"
											? model.deployRoute === "static_s3"
												? "CDN + bucket"
												: "ECS prep"
											: step.id === "deploy"
												? model.deployRoute === "static_s3"
													? "Invalidate"
													: "Run service"
												: "Publish URL";

							const nodeFace = hasWarnings ? "rgba(251,191,36,0.14)" : "rgba(15,23,42,0.92)";
							const nodePort = hasWarnings ? "rgba(180,83,9,0.55)" : "rgba(2,6,23,0.95)";
							const isFirst = stepIndex === 0;
							const isLast = stepIndex === model.steps.length - 1;

							return (
								<React.Fragment key={`spine-${step.id}`}>
									<div className="flex min-w-0 flex-1 flex-col items-stretch px-0.5">
										<div className="flex min-h-[92px] w-full items-center justify-center">
											<button
												type="button"
												onClick={() => {
													const preferred =
														step.id === "auth"
															? stepArtifacts.find((a) => a.action === "openBranch")
															: step.id === "build"
																? stepArtifacts.find((a) => a.action === "openCompose") ?? stepArtifacts.find((a) => a.action === "openDockerfile")
																: step.id === "setup"
																	? stepArtifacts.find((a) => a.action === "openInfra")
																	: step.id === "deploy"
																		? stepArtifacts.find((a) => a.action === "openEnvVars") ?? stepArtifacts.find((a) => a.action === "openNginx")
																		: stepArtifacts.find((a) => a.action === "openCustomDomain");
													if (preferred) openArtifact(preferred);
												}}
												className={cn(
													"relative z-10 w-full max-w-[200px] rounded-2xl px-3.5 py-3 text-left shadow-[0_20px_50px_rgba(0,0,0,0.45)] ring-1 transition",
													hasWarnings
														? "ring-amber-400/25 hover:ring-amber-400/35"
														: "ring-white/8 hover:ring-white/14"
												)}
												style={
													{
														["--node" as string]: nodeFace,
														["--port" as string]: nodePort,
													} as React.CSSProperties
												}
												title={step.description}
											>
												<div
													className={cn(
														"pointer-events-none absolute inset-0 rounded-2xl",
														hasWarnings
															? "bg-gradient-to-b from-amber-500/15 to-amber-950/25"
															: "bg-gradient-to-b from-slate-700/25 to-slate-950/80"
													)}
													aria-hidden
												/>
												<div className="relative z-10 flex items-start justify-between gap-2">
													<div className="min-w-0">
														<div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
															{step.id}
														</div>
														<div className="mt-1 text-[12px] font-semibold leading-snug tracking-tight text-white">{nodeVerb}</div>
													</div>
													<div className="shrink-0">
														{hasWarnings ? (
															<div className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-100 ring-1 ring-amber-400/25">
																<AlertTriangle className="size-3.5" />
																{stepWarnings.length}
															</div>
														) : (
															<div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-1 text-[10px] font-bold text-emerald-100 ring-1 ring-emerald-400/20">
																<CheckCircle2 className="size-3.5" />
																OK
															</div>
														)}
													</div>
												</div>
												{!isFirst ? <Port position="left" /> : null}
												{!isLast ? <Port position="right" /> : null}
												<Port position="bottom" />
											</button>
										</div>
									</div>
									{!isLast ? (
										<div className="flex w-7 shrink-0 flex-col justify-center self-stretch pt-1">
											<div className="h-px w-full rounded-full bg-gradient-to-r from-white/15 via-white/25 to-white/15" />
										</div>
									) : null}
								</React.Fragment>
							);
						})}
					</div>

					{/* Row 2: vertical drop + config per stage (columns align with row 1) */}
					<div className="flex w-full min-w-[min(100%,720px)] flex-row items-start justify-center gap-0">
						{model.steps.map((step, stepIndex) => {
							const stepArtifacts = artifactsByStep[step.id];
							const stepWarnings = warningsByStep[step.id];
							const hasComposeDetails = step.id === "build" && model.composeBuildMode && deployUnits.length > 1;
							const hasExtra = stepWarnings.length > 0 || hasComposeDetails;
							const isLast = stepIndex === model.steps.length - 1;

							return (
								<React.Fragment key={`config-${step.id}`}>
									<div className="flex min-w-0 flex-1 flex-col items-center px-0.5">
										<Trunk className={cn("min-h-10 w-px shrink-0", hasExtra ? "h-10" : "h-6")} />
										<div className="mt-2 flex w-full max-w-[220px] flex-col gap-2">
											{stepArtifacts.length === 0 ? (
												<div className="rounded-xl bg-white/3 px-2.5 py-2 text-center text-[11px] text-white/35">
													No mapped inputs
												</div>
											) : (
												stepArtifacts.map((artifact) => (
													<button
														key={artifact.id}
														type="button"
														onClick={() => openArtifact(artifact)}
														className={cn(
															"relative w-full rounded-xl px-2.5 py-2 text-left text-[11px] font-medium leading-snug text-white/90 ring-1 ring-white/8 transition",
															"bg-white/6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_6px_20px_rgba(0,0,0,0.25)]",
															"hover:bg-white/10 hover:ring-white/12",
															artifact.action ? "" : "cursor-default opacity-75 hover:opacity-90"
														)}
														title={artifact.subtitle ?? artifact.title}
													>
														<span className="block truncate text-white/55">{artifact.title}</span>
														{artifact.subtitle ? (
															<span className="mt-0.5 block truncate font-mono text-[10px] text-white/70">{artifact.subtitle}</span>
														) : null}
													</button>
												))
											)}

											{stepWarnings.slice(0, 3).map((w) => (
												<div
													key={w.id}
													className="relative w-full rounded-xl bg-amber-500/10 px-2.5 py-2 ring-1 ring-amber-400/20"
												>
													<div className="text-xs font-semibold text-amber-50">{w.title}</div>
													<div className="mt-0.5 text-[11px] leading-relaxed text-amber-100/70">{w.description}</div>
												</div>
											))}

											{hasComposeDetails ? (
												<div className="rounded-xl bg-white/5 px-2.5 py-2 ring-1 ring-white/8">
													<details className="group">
														<summary className="cursor-pointer select-none text-xs font-semibold text-white/90">
															Deploy units ({deployUnits.length})
														</summary>
														<div className="mt-2 grid gap-1.5">
															{deployUnits.map((unit) => (
																<div key={unit.name} className="rounded-lg bg-black/25 px-2 py-1.5 ring-1 ring-white/6">
																	<div className="flex flex-wrap items-center justify-between gap-1">
																		<div className="text-xs font-semibold text-white/90">{unit.name}</div>
																		<div className="text-[10px] text-white/45">:{unit.port}</div>
																	</div>
																	<div className="mt-0.5 text-[10px] text-white/45">
																		<span className="font-mono text-white/65">{unit.root}</span>
																		{" · "}
																		<span className="font-mono text-white/65">{unit.type}</span>
																	</div>
																</div>
															))}
														</div>
													</details>
												</div>
											) : null}
										</div>
									</div>
									{!isLast ? <div className="w-7 shrink-0" aria-hidden /> : null}
								</React.Fragment>
							);
						})}
					</div>
				</div>
			</div>

			<Sheet open={editor !== null} onOpenChange={(open) => setEditor(open ? editor : null)}>
				<SheetContent
					side="right"
					className={cn(
						"flex flex-col overflow-hidden border-white/10 bg-[#0b0d12]/96 text-foreground backdrop-blur-xl",
						editor?.kind === "customDomain"
							? "w-[min(100vw,32rem)] sm:max-w-[32rem]"
							: "w-[460px] sm:max-w-[460px]"
					)}
				>
					<SheetHeader className="pr-8">
						<SheetTitle className="text-2xl">
							{editor?.kind === "branch"
								? "Branch"
								: editor?.kind === "dockerfile"
									? "Railpack plan"
									: editor?.kind === "compose"
										? "Deploy units"
										: editor?.kind === "infra"
											? "Infrastructure"
											: editor?.kind === "envVars"
												? "Environment variables"
												: editor?.kind === "nginx"
													? "Nginx"
													: editor?.kind === "customDomain"
														? "Custom domain"
														: "Details"}
						</SheetTitle>
						<SheetDescription className="text-sm text-muted-foreground">
							{editor?.kind === "customDomain"
								? "Choose a subdomain on our host, or clear it to remove the custom URL."
								: "Edits here update the deployment configuration or scan artifacts."}
						</SheetDescription>
					</SheetHeader>

					<div className="mt-6 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 stealth-scrollbar">
						{editor?.kind === "branch" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
								<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Deployment branch</div>
								<Select
									value={deployment.branch || ""}
									onValueChange={(next) => void onUpdateDeployment({ branch: next.trim() || "main" })}
								>
									<SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/2 text-sm text-foreground">
										<SelectValue placeholder="Select branch" />
									</SelectTrigger>
									<SelectContent>
										{branchOptions.map((b) => (
											<SelectItem key={b} value={b}>
												{b}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}

						{editor?.kind === "envVars" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
								<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Runtime env vars</div>
								<Textarea
									value={deployment.envVars ?? ""}
									onChange={(e) => void onUpdateDeployment({ envVars: e.target.value })}
									placeholder="KEY=value"
									className="min-h-44 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
								/>
							</div>
						) : null}

						{editor?.kind === "compose" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
								<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Deploy units</div>
								<Textarea
									readOnly
									value={JSON.stringify(deployUnits, null, 2)}
									className="min-h-44 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
								/>
							</div>
						) : null}

						{editor?.kind === "dockerfile" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4">
								<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Railpack plan</div>
								<div className="mb-2 text-xs text-muted-foreground">
									Unit: <span className="font-mono">{selectedUnit?.name ?? "—"}</span>
									{selectedUnit?.root ? (
										<>
											{" · "}
											<span className="font-mono">{selectedUnit.root}</span>
										</>
									) : null}
								</div>
								<Textarea
									readOnly
									value={railpackPlanJson}
									placeholder="No Railpack plan for this unit."
									className="min-h-64 rounded-xl border-white/10 bg-white/2 text-sm text-foreground font-mono"
								/>
								{deployUnits.length > 1 ? (
									<div className="mt-3">
										<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Switch unit</div>
										<div className="grid gap-2">
											{deployUnits.map((unit) => (
												<Button
													key={unit.name}
													type="button"
													variant="outline"
													className="h-9 justify-start border-white/10 bg-white/2 px-3 font-mono text-xs"
													onClick={() => setEditor({ kind: "dockerfile", unitName: unit.name })}
												>
													{unit.name}
												</Button>
											))}
										</div>
									</div>
								) : null}
							</div>
						) : null}

						{editor?.kind === "nginx" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4 text-sm text-muted-foreground">
								Railpack analyze deploys use ALB/ingress routing at deploy time; nginx.conf is not part of the analyze response.
							</div>
						) : null}

						{editor?.kind === "infra" ? (
							<div className="rounded-2xl border border-white/8 bg-white/3 p-4 space-y-4">
								<div>
									<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Region</div>
									<Select
										value={(deployment.awsRegion || "").trim() || defaultAwsRegionForDeploy()}
										onValueChange={(next) => void onUpdateDeployment({ awsRegion: next })}
									>
										<SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/2 text-sm text-foreground">
											<SelectValue placeholder="Select region" />
										</SelectTrigger>
										<SelectContent className="max-h-72 border-white/10 bg-[#0A0A0F]">
											{regionSelectOptions.map((opt) => (
												<SelectItem key={opt.value} value={opt.value} className="py-2">
													<div className="flex flex-col gap-0.5 text-left">
														<span className="text-sm text-foreground">{opt.label}</span>
														<span className="font-mono text-[10px] text-muted-foreground">{opt.value}</span>
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{model.deployRoute === "ecs" ? (
									<div>
										<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instance type</div>
										<p className="text-sm text-muted-foreground">
											Container deploys use ECS Fargate (configured via server env: cluster, subnets, execution role).
										</p>
									</div>
								) : (
									<div>
										<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Static hosting</div>
										<p className="text-sm text-muted-foreground">
											Static sites publish to S3 and are served through CloudFront (STATIC_SITE_* env vars on the server).
										</p>
									</div>
								)}
							</div>
						) : null}

						{editor?.kind === "customDomain" ? (
							<div className="min-w-0 space-y-5 rounded-2xl border border-white/8 bg-white/[0.03] p-5">
								<div className="space-y-1.5">
									<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
										<Globe className="size-4 shrink-0 text-muted-foreground/70" />
										Live URL
									</div>
									<p className="text-[13px] leading-relaxed text-muted-foreground">
										This becomes the public URL for your app. Only the subdomain is editable; the rest is fixed.
									</p>
								</div>

								<div className="min-w-0 space-y-2">
									<div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
										<div className="flex min-h-11 min-w-0 items-stretch divide-x divide-white/10">
											<div className="flex shrink-0 items-center bg-white/[0.03] px-3">
												<span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground/60">https://</span>
											</div>
											<Input
												value={subdomainDraft}
												placeholder="my-app"
												aria-label="Subdomain"
												className="h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
												onChange={(e) => {
													setSubdomainDraft(e.target.value);
													setCustomUrlStatus({ type: null });
												}}
											/>
											<div className="flex max-w-[55%] shrink-0 items-center gap-2 bg-white/[0.03] px-3">
												<span
													className="truncate font-mono text-[11px] text-muted-foreground/45"
													title={`.${DOMAIN_SUFFIX}`}
												>
													.{DOMAIN_SUFFIX}
												</span>
												<span className="flex shrink-0 items-center gap-1">
													{customUrlVerifying ? (
														<RotateCw className="size-3.5 shrink-0 animate-spin text-primary" />
													) : null}
													{!customUrlVerifying && customUrlStatus.type === "success" ? (
														<CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
													) : null}
													{!customUrlVerifying && customUrlStatus.type === "error" ? (
														<AlertTriangle className="size-3.5 shrink-0 text-destructive" />
													) : null}
												</span>
											</div>
										</div>
									</div>
									<p className="break-words font-mono text-[11px] text-muted-foreground/55">
										Preview:{" "}
										<span className="text-foreground/80">
											{getCustomUrlFromSubdomain(subdomainDraft) || "—"}
										</span>
									</p>
								</div>

								{customUrlStatus.type && !customUrlVerifying ? (
									<Alert
										className={cn(
											"border-none py-2.5 px-3",
											customUrlStatus.type === "error"
												? "bg-destructive/10 text-destructive"
												: "bg-emerald-500/10 text-emerald-500"
										)}
									>
										<AlertDescription className="text-xs font-medium leading-snug">
											{customUrlStatus.message}
										</AlertDescription>
									</Alert>
								) : null}

								<div className="flex flex-col gap-4 pt-1">
									<div className="flex flex-wrap items-center gap-2">
										<Button
											type="button"
											variant="ghost"
											className="h-10 px-4 text-sm"
											onClick={handleCancelCustomUrl}
											disabled={!isCustomUrlDirty || customUrlSaving}
										>
											Cancel
										</Button>
										<Button
											type="button"
											className="h-10 min-w-[5.5rem] px-5 text-sm"
											onClick={() => void handleSaveCustomUrl()}
											disabled={!isCustomUrlDirty || customUrlSaving}
										>
											{customUrlSaving ? "Saving…" : "Save"}
										</Button>
									</div>
									<p className="w-full min-w-0 text-[11px] leading-relaxed text-muted-foreground/75">
										Saving updates load balancer routing and Route 53 DNS. You don’t need to redeploy.
									</p>
								</div>
							</div>
						) : null}
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

