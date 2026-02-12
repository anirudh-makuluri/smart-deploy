import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay, parseEnvLinesToEntries, buildEnvVarsString, parseEnvVarsToStore, sanitizeAndParseAIResponse } from "@/lib/utils";
import { toast } from "sonner";
import { selectDeploymentTargetFromMetadata, type DeploymentAnalysisFromMetadata } from "@/lib/deploymentTargetFromMetadata";
import { useAppData } from "@/store/useAppData";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Textarea } from "@/components/ui/textarea"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
} from "@/components/ui/form"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import DeploymentAccordion from "@/components/DeploymentAccordion";
import ServiceLogs from "@/components/ServiceLogs";
import DeployOptions from "@/components/DeployOptions";
import { RotateCw, Upload, Trash2, Plus } from "lucide-react";
import type { SubmitHandler } from "react-hook-form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AIGenProjectMetadata, AWSDeploymentTarget, DeployConfig, DeployStep, repoType } from "@/app/types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { formatDeploymentTargetName } from "@/lib/utils";
import { Label } from "@/components/ui/label";


export type FormSchemaType = z.infer<typeof formSchema>

export type CombinedSubmitType = FormSchemaType & AIGenProjectMetadata;

export const formSchema = z.object({
	url: z.string().url({ message: "Must be a valid URL" }),
	service_name: z.string(),
	branch: z.string().min(1, { message: "Branch is required" }),
	install_cmd: z.string().optional(),
	build_cmd: z.string().optional(),
	run_cmd: z.string().optional(),
	env_vars: z.string().optional(),
	workdir: z.string().optional(),
	use_custom_dockerfile: z.boolean(),
	custom_url: z.string().optional(),
})

const exampleProjectMetadata: AIGenProjectMetadata = {
	"core_deployment_info": {
		"language": "TypeScript",
		"framework": "Next.js",
		"install_cmd": "npm install",
		"build_cmd": "next build",
		"run_cmd": "next start",
		"workdir": null
	},
	"features_infrastructure": {
		"uses_websockets": true,
		"uses_cron": false,
		"uses_mobile": false,
		"cloud_run_compatible": false, //CHANGE HERE
		"is_library": false,
		"requires_build_but_missing_cmd": true //CHANGE HERE
	},
	"final_notes": {
		"comment": "The project is well-structured and uses a popular framework. It incorporates testing and logging, but lacks additional tooling such as docs and external logging libraries."
	}
}

const AUTO_SAVE_DEBOUNCE_MS = 500;

export default function ConfigTabs(
	{ service_name, onSubmit, onScanComplete, onConfigChange, editMode, isDeploying, id, serviceLogs, steps, deployment, repo, deployError, deployingCommitInfo }:
		{
			service_name: string, onSubmit: (data: FormSchemaType & Partial<AIGenProjectMetadata> & { commitSha?: string }) => void, onScanComplete: (data: FormSchemaType & Partial<AIGenProjectMetadata>) => void | Promise<void>, onConfigChange?: (partial: Partial<DeployConfig>) => void, editMode: boolean, isDeploying: boolean, id: string,
			steps: DeployStep[], serviceLogs: { timestamp: string, message?: string }[], repo: repoType, deployment?: DeployConfig, deployError?: string | null, deployingCommitInfo?: { sha: string; message: string; author: string; date: string } | null
		}) {

	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const envFileInputRef = React.useRef<HTMLInputElement>(null);
	const lastSavedSnapshotRef = React.useRef<string | null>(null);
	const [envEntries, setEnvEntries] = useState<{ name: string; value: string }[]>(() =>
		parseEnvVarsToDisplay(deployment?.env_vars ?? "")
	);

	const [isAiFetching, setAiFetching] = useState(false);
	const [customUrlVerifying, setCustomUrlVerifying] = useState(false);
	const [customUrlStatus, setCustomUrlStatus] = useState<{ type: 'success' | 'error' | 'owned' | null; message?: string; alternatives?: string[] }>({ type: null });
	const [projectMetadata, setProjectMetadata] = useState<AIGenProjectMetadata | null>(
		deployment?.core_deployment_info && deployment?.features_infrastructure && deployment?.final_notes
			? {
				core_deployment_info: deployment.core_deployment_info,
				features_infrastructure: deployment.features_infrastructure,
				final_notes: deployment.final_notes,
			}
			: null
	);

	const isDeploymentTarget = (t: string): t is AWSDeploymentTarget =>
		["amplify", "elastic-beanstalk", "ecs", "ec2", "cloud-run"].includes(t);
	const [deploymentAnalysis, setDeploymentAnalysis] = useState<DeploymentAnalysisFromMetadata | null>(() => {
		const t = deployment?.deploymentTarget;
		const r = deployment?.deployment_target_reason;
		if (t && r && isDeploymentTarget(t)) return { target: t, reason: r, warnings: [] };
		return null;
	});

	// Available deployment targets
	const deploymentTargets: AWSDeploymentTarget[] = ["amplify", "elastic-beanstalk", "ecs", "ec2", "cloud-run"];

	// Handler for manual deployment target selection
	const handleDeploymentTargetChange = (target: string) => {
		if (isDeploymentTarget(target)) {
			setDeploymentAnalysis({
				target,
				reason: `Manually selected ${formatDeploymentTargetName(target)}.`,
				warnings: [],
			});
		}
	};

	const [dockerfileContent, setDockerfileContent] = useState<string | undefined>(deployment?.dockerfileContent);
	const branches = React.useRef(repo ? repo.branches.map(dat => dat.name) : ["main"]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			url: repo?.html_url,
			service_name: service_name || repo?.name,
			branch: deployment?.branch || "main",
			install_cmd: deployment?.core_deployment_info?.install_cmd || "",
			build_cmd: deployment?.core_deployment_info?.build_cmd || "",
			run_cmd: deployment?.core_deployment_info?.run_cmd || "",
			env_vars: deployment?.env_vars || "",
			workdir: deployment?.core_deployment_info?.workdir || "",
			use_custom_dockerfile: deployment?.use_custom_dockerfile || false,
			custom_url: deployment?.custom_url || "",
		},
	})

	// When deployment becomes available (e.g. saved scan loaded from DB), pre-fill form and metadata
	const appliedDeploymentId = React.useRef<string | null>(null);
	useEffect(() => {
		if (!deployment?.id) {
			appliedDeploymentId.current = null;
			return;
		}
		// Only sync when opening a deployment we haven't synced yet (avoid overwriting in-progress edits)
		if (appliedDeploymentId.current === deployment.id) return;
		appliedDeploymentId.current = deployment.id;
		form.reset({
			url: repo?.html_url ?? deployment.url,
			service_name: deployment.service_name || service_name || repo?.name,
			branch: deployment.branch || "main",
			install_cmd: deployment.core_deployment_info?.install_cmd ?? "",
			build_cmd: deployment.core_deployment_info?.build_cmd ?? "",
			run_cmd: deployment.core_deployment_info?.run_cmd ?? "",
			env_vars: deployment.env_vars ?? "",
			workdir: deployment.core_deployment_info?.workdir ?? "",
			use_custom_dockerfile: deployment.use_custom_dockerfile ?? false,
			custom_url: deployment.custom_url ?? "",
		});
		setEnvEntries(parseEnvVarsToDisplay(deployment.env_vars ?? ""));
		if (deployment.core_deployment_info && deployment.features_infrastructure && deployment.final_notes) {
			setProjectMetadata({
				core_deployment_info: deployment.core_deployment_info,
				features_infrastructure: deployment.features_infrastructure,
				final_notes: deployment.final_notes,
			});
		}
		if (deployment.deploymentTarget && deployment.deployment_target_reason && isDeploymentTarget(deployment.deploymentTarget)) {
			setDeploymentAnalysis({
				target: deployment.deploymentTarget,
				reason: deployment.deployment_target_reason,
				warnings: [],
			});
		}
		// Initialize "last saved" snapshot so we don't send a request until user actually changes something
		const initialPartial: Partial<DeployConfig> = {
			id: deployment.id,
			url: deployment.url ?? repo?.html_url ?? "",
			service_name: (deployment.service_name || service_name || repo?.name) ?? "",
			branch: deployment.branch ?? "main",
			use_custom_dockerfile: deployment.use_custom_dockerfile ?? false,
			env_vars: deployment.env_vars ?? "",
			...(deployment.custom_url && { custom_url: deployment.custom_url }),
			...(deployment.deploymentTarget && isDeploymentTarget(deployment.deploymentTarget) && {
				deploymentTarget: deployment.deploymentTarget,
				deployment_target_reason: deployment.deployment_target_reason,
			}),
			...(deployment.core_deployment_info && deployment.features_infrastructure && deployment.final_notes && {
				core_deployment_info: deployment.core_deployment_info,
				features_infrastructure: deployment.features_infrastructure,
				final_notes: deployment.final_notes,
			}),
		};
		lastSavedSnapshotRef.current = JSON.stringify(initialPartial);
	}, [deployment, repo?.html_url, service_name, repo?.name]);

	// Auto-save config to DB only when something actually changed
	const onConfigChangeRef = React.useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;
	const watchedForm = form.watch();
	useEffect(() => {
		if (!onConfigChangeRef.current || !deployment?.id) return;
		const timer = setTimeout(() => {
			const values = form.getValues();
			// Merge user-edited form fields into core_deployment_info
			const baseCoreInfo = projectMetadata?.core_deployment_info ?? deployment?.core_deployment_info;
			const mergedCoreInfo = baseCoreInfo
				? {
						...baseCoreInfo,
						...(values.install_cmd != null && { install_cmd: values.install_cmd }),
						...(values.run_cmd != null && { run_cmd: values.run_cmd }),
						...(values.workdir != null && { workdir: values.workdir || null }),
					}
				: undefined;

			const partial: Partial<DeployConfig> = {
				id: deployment.id,
				url: values.url,
				service_name: values.service_name,
				branch: values.branch,
				use_custom_dockerfile: values.use_custom_dockerfile,
				env_vars: parseEnvVarsToStore(buildEnvVarsString(envEntries)),
				...(values.custom_url && { custom_url: values.custom_url }),
				...(deploymentAnalysis && {
					deploymentTarget: deploymentAnalysis.target,
					deployment_target_reason: deploymentAnalysis.reason,
				}),
				...(mergedCoreInfo && { core_deployment_info: mergedCoreInfo }),
				...(projectMetadata && {
					features_infrastructure: projectMetadata.features_infrastructure,
					final_notes: projectMetadata.final_notes,
				}),
			};
			const snapshot = JSON.stringify(partial);
			if (lastSavedSnapshotRef.current === snapshot) return;
			lastSavedSnapshotRef.current = snapshot;
			onConfigChangeRef.current?.(partial);
		}, AUTO_SAVE_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [watchedForm, envEntries, deploymentAnalysis, projectMetadata, deployment?.id]);

	function handleAIBtn() {
		setAiFetching(true);

		if (!repo?.full_name || !repo.default_branch) return;

		fetch('/api/llm', {
			method: "POST",
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ full_name: repo.full_name, branch: repo.default_branch, include_extra_info: true })
		}).then(res => res.json())
			.then((response) => {
				setAiFetching(false);
				const parsed_response = sanitizeAndParseAIResponse(response);
				setProjectMetadata(parsed_response ?? null);
				const core_deployment_info = parsed_response?.core_deployment_info;
				if (core_deployment_info) {
					form.setValue('install_cmd', core_deployment_info.install_cmd);
					form.setValue('build_cmd', core_deployment_info.build_cmd);
					form.setValue('run_cmd', core_deployment_info.run_cmd);
					form.setValue('workdir', core_deployment_info.workdir ?? '');
				}
				const analysis = parsed_response ? selectDeploymentTargetFromMetadata(parsed_response) : null;
				if (analysis) {
					setDeploymentAnalysis(analysis);
				} else {
					// If no analysis, reset to null (user can manually select)
					setDeploymentAnalysis(null);
				}
				if (parsed_response) {
					const payload = {
						...form.getValues(),
						...parsed_response,
						...(analysis && { deploymentTarget: analysis.target, deployment_target_reason: analysis.reason }),
					};
					onScanComplete(payload);
				}
			})
	}


	const featuresInfra = projectMetadata?.features_infrastructure;

	// Check if deployment should be disabled
	const isDeployDisabled = React.useMemo(() => {
		// Mobile-only code (no server/backend)
		if (featuresInfra?.uses_mobile && !featuresInfra?.uses_server && !projectMetadata?.core_deployment_info?.run_cmd) {
			return true;
		}
		// Library (not deployable)
		if (featuresInfra?.is_library) {
			return true;
		}
		// No deployable code (no language detected or no run command)
		if (!projectMetadata?.core_deployment_info?.language && !projectMetadata?.core_deployment_info?.run_cmd) {
			return true;
		}
		// No compatible deployment target found
		if (projectMetadata && !deploymentAnalysis) {
			// Check if service_compatibility exists and all are false
			const compat = (projectMetadata as any).service_compatibility;
			if (compat && typeof compat === "object") {
				const allFalse = Object.values(compat).every(v => v === false);
				if (allFalse) return true;
			}
		}
		return false;
	}, [featuresInfra, projectMetadata, deploymentAnalysis]);

	return (
		<>
			{!isDeployDisabled && (
				<Card className="mb-4 border-[#1e3a5f]/60 bg-[#132f4c]/60">
					<CardHeader className="pb-2">
						<CardTitle className="text-base font-medium flex items-center gap-2 text-[#e2e8f0]">
							Deployment Target
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{editMode ? (
							<Select
								value={deploymentAnalysis?.target || ""}
								onValueChange={handleDeploymentTargetChange}
							>
								<SelectTrigger className="border-[#1e3a5f] bg-[#0c1929]/50 text-[#e2e8f0] focus:ring-[#1d4ed8]">
									<SelectValue placeholder="Select deployment target" />
								</SelectTrigger>
								<SelectContent>
									{deploymentTargets.map((target) => (
										<SelectItem key={target} value={target}>
											{formatDeploymentTargetName(target)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<p className="font-semibold text-[#e2e8f0]">
								{deploymentAnalysis ? formatDeploymentTargetName(deploymentAnalysis.target) : "Not selected"}
							</p>
						)}
						{deploymentAnalysis && (
							<>
								<p className="text-sm text-[#94a3b8]">{deploymentAnalysis.reason}</p>
								{deploymentAnalysis.warnings.length > 0 && (
									<ul className="text-xs text-[#f59e0b] list-disc list-inside mt-1">
										{deploymentAnalysis.warnings.map((w, i) => (
											<li key={i}>{w}</li>
										))}
									</ul>
								)}
							</>
						)}
					</CardContent>
				</Card>
			)}
			{projectMetadata && (
				<>
					{(featuresInfra?.uses_mobile ||
						featuresInfra?.is_library ||
						isDeployDisabled) && (
							<Alert variant="destructive" className="border-[#dc2626]/50 bg-[#dc2626]/10 text-[#e2e8f0]">
								<AlertTitle className="text-[#fca5a5]">Deployment Disabled</AlertTitle>
								<AlertDescription className="text-[#94a3b8]">
									<p>
										❌ This project <strong>cannot be deployed</strong>.
									</p>
									<ul className="list-disc pl-4 mt-2 text-sm">
										{featuresInfra?.uses_mobile && !featuresInfra?.uses_server && !projectMetadata?.core_deployment_info?.run_cmd && (
											<li>It is a mobile-only app with no server/backend code</li>
										)}
										{featuresInfra?.is_library && <li>It is a library, not a deployable service</li>}
										{!projectMetadata?.core_deployment_info?.language && !projectMetadata?.core_deployment_info?.run_cmd && (
											<li>No deployable code detected (empty repo or docs-only)</li>
										)}
										{projectMetadata && !deploymentAnalysis && (() => {
											const compat = (projectMetadata as any).service_compatibility;
											if (compat && typeof compat === "object" && Object.values(compat).every(v => v === false)) {
												return <li>No compatible deployment platform found</li>;
											}
											return null;
										})()}
									</ul>
								</AlertDescription>
							</Alert>
						)}

					{featuresInfra?.requires_build_but_missing_cmd && (
						<Alert variant="destructive" className="border-[#dc2626]/50 bg-[#dc2626]/10 text-[#e2e8f0]">
							<AlertTitle className="text-[#fca5a5]">Error!</AlertTitle>
							<AlertDescription className="text-[#94a3b8]">
								<p>
									❌ Build is required but no build command was detected. <strong>Deployment will fail.</strong>
								</p>
							</AlertDescription>
						</Alert>
					)}
					{
						projectMetadata.final_notes?.comment && (
							<Card className="my-4 border-[#1e3a5f]/60 bg-[#132f4c]/60">
								<CardHeader>
									<CardTitle className="text-[#e2e8f0]">💡 Final AI Notes</CardTitle>
								</CardHeader>
								<CardContent className="text-[#94a3b8] text-sm whitespace-pre-wrap">
									{projectMetadata?.final_notes?.comment}
								</CardContent>
							</Card>
						)
					}
					<Alert className="my-4 border-[#1e3a5f]/60 bg-[#132f4c]/40 text-[#94a3b8]">
						<AlertDescription className="text-sm">
							AI can make mistakes. Please verify the detected settings (commands, framework, etc.) before deploying for a higher success rate.
						</AlertDescription>
					</Alert>
				</>
			)}
			<Tabs defaultValue="env_config">
				{
					isDeploying || (deployment && deployment?.status != 'didnt_deploy') ? (
						<TabsList className="bg-[#132f4c]/60 border border-[#1e3a5f]/60">
							<TabsTrigger value="env_config" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">Environment & Configuration</TabsTrigger>
							{deployment?.status != 'didnt_deploy' ? <TabsTrigger value="service_logs" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">Service Logs</TabsTrigger> : null}
							{isDeploying && (
								<TabsTrigger value="deploy_logs" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">
									Deploy Logs
									{deployingCommitInfo && (
										<span className="ml-2 text-xs text-[#94a3b8] font-normal">
											({deployingCommitInfo.sha.substring(0, 7)}: {deployingCommitInfo.message.split('\n')[0].substring(0, 40)}{deployingCommitInfo.message.split('\n')[0].length > 40 ? '...' : ''})
										</span>
									)}
								</TabsTrigger>
							)}
						</TabsList>
					) : null
				}
				<TabsContent value="env_config">
					<Form {...form}>
						<form onSubmit={form.handleSubmit((data) => {
							const envString = buildEnvVarsString(envEntries);
							onSubmit({
								...data,
								env_vars: envString,
								...(projectMetadata ?? {}), // merge only if not null
								...(deploymentAnalysis && { 
									deploymentTarget: deploymentAnalysis.target, 
									deployment_target_reason: deploymentAnalysis.reason 
								}),
							});
						})} className="h-full py-4 px-4 sm:px-8 lg:px-12">
							<p className="font-bold text-xl whitespace-nowrap my-4 text-[#e2e8f0]">Environment & Configuration</p>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />
							{editMode && (
								<div className="flex flex-row items-center gap-4 my-6 flex-wrap">
									<Button
										disabled={isAiFetching}
										variant="outline"
										onClick={handleAIBtn}
										className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50"
									>
										<RotateCw className={isAiFetching ? "animate-spin" : ""} />
										Smart Project Scan
									</Button>
									{deployment && deployment?.status != 'didnt_deploy' ? (
										<Button 
											type="submit" 
											disabled={isDeployDisabled || isDeploying}
											className="landing-build-blue hover:opacity-95 text-white disabled:opacity-50 disabled:cursor-not-allowed"
										>
											Save Changes
										</Button>
									) : (
										<DeployOptions
											onDeploy={(commitSha) => {
												const formValues = form.getValues();
												const envString = buildEnvVarsString(envEntries);
												onSubmit({
													...formValues,
													env_vars: envString,
													...(projectMetadata ?? {}),
													...(deploymentAnalysis && { 
														deploymentTarget: deploymentAnalysis.target, 
														deployment_target_reason: deploymentAnalysis.reason 
													}),
													...(commitSha && { commitSha }),
												});
											}}
											disabled={isDeployDisabled || isDeploying}
											repo={repo}
											branch={form.watch("branch") || deployment?.branch || "main"}
										/>
									)}
								</div>
							)}

							<div className="my-4 flex flex-row justify-start items-center space-x-4 flex-wrap gap-2">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Service Name:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="service_name"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Input {...field} className="border-[#1e3a5f] bg-[#0c1929]/50 text-[#e2e8f0] placeholder:text-[#64748b] focus-visible:ring-[#1d4ed8]" />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.service_name}</span>
								)}
								{projectMetadata?.core_deployment_info.language && <Badge variant="outline" className="border-[#1e3a5f] text-[#94a3b8]">Language: {projectMetadata?.core_deployment_info.language}</Badge>}
								{projectMetadata?.core_deployment_info.framework && <Badge variant="outline" className="border-[#1e3a5f] text-[#94a3b8]">Framework: {projectMetadata?.core_deployment_info.framework}</Badge>}

							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />

							{/* Install Command */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Install Command:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="install_cmd"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Input {...field} />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.core_deployment_info?.install_cmd}</span>
								)}
							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />

							{/* Build Command */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Build Command:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="build_cmd"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Input {...field} />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.core_deployment_info?.build_cmd}</span>
								)}
							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />

							{/* Run Command */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Run Command:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="run_cmd"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Input {...field} />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.core_deployment_info?.run_cmd}</span>
								)}
							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />

							{/* Branch */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Branch:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="branch"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Select
														onValueChange={field.onChange}
														defaultValue={field.value}
													>
														<SelectTrigger>
															<SelectValue placeholder="Select a branch" />
														</SelectTrigger>
														<SelectContent>
															{branches.current.map((branch) => (
																<SelectItem key={branch} value={branch}>
																	{branch}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.branch}</span>
								)}
							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />
						{/* Custom URL */}
						<div className="my-4 flex flex-col space-y-2">
							<div className="flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Custom URL:</span>
								{editMode ? (
									<div className="flex-1 max-w-md space-y-2">
										<div className="flex items-center gap-2">
											<Input
												placeholder="Enter subdomain (e.g., my-app)"
												value={form.watch("custom_url") ? form.watch("custom_url")!.replace(/^https?:\/\//, "").split(".")[0] : ""}
												onChange={(e) => {
													const subdomain = e.target.value;
													const domain = process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "";
													const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
													const fullUrl = subdomain ? `https://${subdomain}.${baseDomain}` : "";
													form.setValue("custom_url", fullUrl);
													setCustomUrlStatus({ type: null });
												}}
												onKeyDown={async (e) => {
													if (e.key === "Enter") {
														e.preventDefault();
														const customUrl = form.watch("custom_url");
														if (!customUrl) return;

														const subdomain = customUrl.replace(/^https?:\/\//, "").split(".")[0];
														if (!subdomain) return;

														setCustomUrlVerifying(true);
														try {
															const res = await fetch("/api/verify-dns", {
																method: "POST",
																headers: { "Content-Type": "application/json" },
																body: JSON.stringify({ 
																	subdomain,
																	currentDeploymentId: id 
																}),
															});
															const data = await res.json();

															if (data.available) {
																if (data.isOwned) {
																	setCustomUrlStatus({ 
																		type: 'owned', 
																		message: `This is your current URL: ${data.customUrl}` 
																	});
																} else {
																	setCustomUrlStatus({ 
																		type: 'success', 
																		message: `✓ Available: ${data.customUrl}` 
																	});
																}
																form.setValue("custom_url", data.customUrl);
															} else {
																setCustomUrlStatus({ 
																	type: 'error', 
																	message: data.message || "Subdomain is already taken",
																	alternatives: data.alternatives || []
																});
															}
														} catch (error) {
															setCustomUrlStatus({ 
																type: 'error', 
																message: "Failed to verify subdomain" 
															});
														} finally {
															setCustomUrlVerifying(false);
														}
													}
												}}
												className="border-[#1e3a5f] bg-[#0c1929]/50 text-[#e2e8f0] placeholder:text-[#64748b] focus-visible:ring-[#1d4ed8]"
												disabled={customUrlVerifying}
											/>
											<span className="text-[#94a3b8] text-sm whitespace-nowrap">.{process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}</span>
										</div>
										{customUrlVerifying && (
											<p className="text-xs text-[#94a3b8]">Verifying subdomain...</p>
										)}
										{customUrlStatus.type === 'success' && (
											<p className="text-xs text-[#14b8a6]">{customUrlStatus.message}</p>
										)}
										{customUrlStatus.type === 'owned' && (
											<p className="text-xs text-[#60a5fa]">{customUrlStatus.message}</p>
										)}
										{customUrlStatus.type === 'error' && (
											<div className="text-xs space-y-1">
												<p className="text-[#f87171]">{customUrlStatus.message}</p>
												{customUrlStatus.alternatives && customUrlStatus.alternatives.length > 0 && (
													<div className="space-y-1">
														<p className="text-[#94a3b8]">Available alternatives:</p>
														<div className="flex gap-2 flex-wrap">
															{customUrlStatus.alternatives.map((alt) => (
																<button
																	key={alt}
																	type="button"
																	onClick={() => {
																		const domain = process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "";
																		const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
																		form.setValue("custom_url", `https://${alt}.${baseDomain}`);
																		setCustomUrlStatus({ type: null });
																	}}
																	className="px-2 py-1 text-[#14b8a6] bg-[#14b8a6]/10 border border-[#14b8a6]/40 rounded hover:bg-[#14b8a6]/20 transition-colors"
																>
																	{alt}
																</button>
															))}
														</div>
													</div>
												)}
											</div>
										)}
										<p className="text-xs text-[#64748b]">Press Enter to verify availability</p>
									</div>
								) : (
									<span className="text-[#94a3b8]">{deployment?.custom_url || 'Not set'}</span>
								)}
							</div>
						</div>
						<Separator className="bg-[#1e3a5f]/60 h-px" />
							{/* Working Directory */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-37.5 text-[#e2e8f0]">Working Directory:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="workdir"
										render={({ field }) => (
											<FormItem className="w-40">
												<FormControl>
													<Input {...field} />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">{deployment?.core_deployment_info?.workdir || '-'}</span>
								)}
							</div>
							<Separator className="bg-[#1e3a5f]/60 h-[1px]" />

							{/* Custom Dockerfile */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Custom Dockerfile:</span>
								{editMode ? (
									<FormField
										control={form.control}
										name="use_custom_dockerfile"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Switch
														disabled
														checked={field.value}
														onCheckedChange={field.onChange}
													/>
												</FormControl>
												{field.value && (
													<div>
														<label className="block text-sm font-medium text-[#94a3b8] mb-1">
															Upload Dockerfile
														</label>
														<Input
															type="file"
															accept=".dockerfile,.txt,.Dockerfile"
															onChange={(e) => {
																const file = e.target.files?.[0];
																if (file) setDockerfile(file);
															}}
														/>
													</div>
												)}
											</FormItem>
										)}
									/>
								) : (
									<span className="text-[#94a3b8] w-40">
										{deployment?.use_custom_dockerfile ? 'Yes' : 'No'}
									</span>
								)}
							</div>
							{/* {
							dockerfileContent && (
								<div className="bg-card p-2 rounded-md">
									<p className="text-sm">{dockerfileContent}</p>
								</div>
							)
						} */}

							{/* Env Vars */}
							<p className="font-bold text-xl whitespace-nowrap mt-10 text-[#e2e8f0]">Environment Variables</p>
							<div className="w-full mt-2">
								{editMode ? (
									<div className="space-y-3">
										<div className="max-h-[300px] overflow-y-auto space-y-2">
										{(envEntries.length > 0 ? envEntries : [{ name: "", value: "" }]).map((row, index) => (
											<div key={index} className="flex flex-wrap items-center gap-2">
												<div className="flex-1 min-w-[140px] space-y-1">
													<Label className="text-xs text-[#94a3b8]">Key</Label>
													<Input
														placeholder="e.g. NODE_ENV"
														value={row.name}
														onChange={(e) => {
															const displayRows = envEntries.length > 0 ? envEntries : [{ name: "", value: "" }];
															const next = displayRows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r));
															setEnvEntries(next.filter((r) => r.name.trim() || r.value.trim()).length ? next : []);
														}}
														onPaste={(e) => {
															const pasted = e.clipboardData?.getData("text");
															if (pasted && /\n/.test(pasted)) {
																e.preventDefault();
																const parsed = parseEnvLinesToEntries(pasted);
																const existingKeys = new Set((envEntries.length > 0 ? envEntries : []).filter((r) => r.name.trim()).map((r) => r.name));
																const toAdd = parsed.filter((p) => p.name.trim() && !existingKeys.has(p.name));
																setEnvEntries([...(envEntries.length > 0 ? envEntries : []), ...toAdd]);
															}
														}}
														className="bg-[#0f172a]/80 border-[#1e3a5f]/60 text-[#e2e8f0] placeholder:text-[#64748b]"
													/>
												</div>
												<div className="flex-1 min-w-[140px] space-y-1">
													<Label className="text-xs text-[#94a3b8]">Value</Label>
													<Input
														placeholder="e.g. production"
														value={row.value}
														onChange={(e) => {
															const displayRows = envEntries.length > 0 ? envEntries : [{ name: "", value: "" }];
															const next = displayRows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r));
															setEnvEntries(next.filter((r) => r.name.trim() || r.value.trim()).length ? next : []);
														}}
														className="bg-[#0f172a]/80 border-[#1e3a5f]/60 text-[#e2e8f0] placeholder:text-[#64748b]"
														autoComplete="off"
													/>
												</div>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="mt-6 text-[#94a3b8] hover:text-[#e2e8f0] shrink-0"
													onClick={() => {
														const displayRows = envEntries.length > 0 ? envEntries : [{ name: "", value: "" }];
														const next = displayRows.filter((_, i) => i !== index);
														setEnvEntries(next.length ? next : []);
													}}
													aria-label="Remove variable"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</div>
										))}
										</div>
										<div className="flex flex-wrap items-center gap-2 pt-1">
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="border-[#1e3a5f]/60 text-[#e2e8f0] hover:bg-[#1e3a5f]/30"
												onClick={() => setEnvEntries([...envEntries, { name: "", value: "" }])}
											>
												<Plus className="h-4 w-4 mr-1" />
												Add variable
											</Button>
											<input
												ref={envFileInputRef}
												type="file"
												accept=".env,.env.*,text/plain"
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (!file) return;
													const reader = new FileReader();
													reader.onload = () => {
														const text = (reader.result as string) ?? "";
														const parsed = parseEnvLinesToEntries(text);
														const existingKeys = new Set(envEntries.filter((r) => r.name.trim()).map((r) => r.name));
														const toAdd = parsed.filter((p) => p.name.trim() && !existingKeys.has(p.name));
														setEnvEntries([...envEntries, ...toAdd]);
													};
													reader.readAsText(file);
													e.target.value = "";
												}}
											/>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="border-[#1e3a5f]/60 text-[#e2e8f0] hover:bg-[#1e3a5f]/30"
												onClick={() => envFileInputRef.current?.click()}
											>
												<Upload className="h-4 w-4 mr-1" />
												Import .env
											</Button>
										</div>
									</div>
								) : (
									<>
										{deployment?.env_vars ? (
											<Table className="border border-[#1e3a5f]/60 p-2 rounded-md overflow-hidden">
												<TableHeader className="bg-[#132f4c]/80">
													<TableRow className="border-[#1e3a5f]/40 hover:bg-transparent">
														<TableHead className="text-[#e2e8f0]">Name</TableHead>
														<TableHead className="text-[#e2e8f0]">Value</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{parseEnvVarsToDisplay(deployment.env_vars).map((env, idx) => (
														<TableRow key={idx} className="border-[#1e3a5f]/40 hover:bg-[#1e3a5f]/30">
															<TableCell className="text-[#94a3b8] max-w-[100px] truncate">{env.name}</TableCell>
															<TableCell className="text-[#e2e8f0] font-mono">
																{"*".repeat(Math.min(env.value.length, 25))}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										) : (
											<span className="text-[#94a3b8]">-</span>
										)}
									</>
								)}
							</div>
						</form>
					</Form>
				</TabsContent>
				<TabsContent value="service_logs">
					<p className="font-bold text-xl whitespace-nowrap my-4 text-[#e2e8f0]">Service Logs</p>
					<ServiceLogs logs={serviceLogs} />
				</TabsContent>
				<TabsContent value="deploy_logs">
					<div className="flex items-center gap-2 my-4">
						<p className="font-bold text-xl whitespace-nowrap text-[#e2e8f0]">Deploy Logs</p>
						{deployingCommitInfo && (
							<span className="text-sm text-[#94a3b8] font-normal">
								({deployingCommitInfo.sha.substring(0, 7)}: {deployingCommitInfo.message.split('\n')[0]})
							</span>
						)}
					</div>
					{deployError && (
						<Alert className="mb-4 border-[#dc2626]/50 bg-[#dc2626]/10 text-[#e2e8f0]">
							<AlertTitle className="text-[#fca5a5]">Deployment failed</AlertTitle>
							<AlertDescription className="overflow-x-auto">{deployError}</AlertDescription>
						</Alert>
					)}
					<DeploymentAccordion steps={steps} />
				</TabsContent>
			</Tabs>
		</>
	)
}
