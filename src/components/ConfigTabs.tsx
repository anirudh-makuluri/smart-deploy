import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay, parseEnvLinesToEntries, buildEnvVarsString, parseEnvVarsToStore, sanitizeAndParseAIResponse } from "@/lib/utils";
import { toast } from "sonner";
import { selectDeploymentTargetFromMetadata, isDeploymentDisabled, type DeploymentAnalysisFromMetadata } from "@/lib/deploymentTargetFromMetadata";
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
import DeployOptions from "@/components/DeployOptions";
import { RotateCw, Upload, Trash2, Plus } from "lucide-react";
import type { SubmitHandler } from "react-hook-form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AIGenProjectMetadata, AWSDeploymentTarget, DeployConfig, repoType } from "@/app/types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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

const AUTO_SAVE_DEBOUNCE_MS = 500;

export default function ConfigTabs(
	{ service_name, onSubmit, onScanComplete, onConfigChange, editMode, isDeploying, deployment, repo }:
		{
			service_name: string, onSubmit: (data: FormSchemaType & Partial<AIGenProjectMetadata> & { commitSha?: string }) => void,
			onScanComplete: (data: FormSchemaType & Partial<AIGenProjectMetadata>) => void | Promise<void>,
			onConfigChange?: (partial: Partial<DeployConfig>) => void,
			editMode: boolean, isDeploying: boolean,
			repo: repoType, deployment?: DeployConfig
		}) {

	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const envFileInputRef = React.useRef<HTMLInputElement>(null);
	const lastSavedSnapshotRef = React.useRef<string | null>(null);
	const [envEntries, setEnvEntries] = useState<{ name: string; value: string }[]>(() =>
		parseEnvVarsToDisplay(deployment?.env_vars ?? "")
	);
	const appliedDeploymentId = React.useRef<string | null>(null);
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
	// Always use EC2 for AWS deployments; deployment target selector has been removed
	const [deploymentAnalysis, setDeploymentAnalysis] = useState<DeploymentAnalysisFromMetadata>(() => ({
		target: "ec2",
		reason: "Using EC2.",
		warnings: [],
	}));

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


	useEffect(() => {
		if (!deployment?.id) {
			appliedDeploymentId.current = null;
			return;
		}

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
		// deploymentAnalysis is always EC2; not synced from deployment

		const initialPartial: Partial<DeployConfig> = {
			id: deployment.id,
			url: deployment.url ?? repo?.html_url ?? "",
			service_name: (deployment.service_name || service_name || repo?.name) ?? "",
			branch: deployment.branch ?? "main",
			use_custom_dockerfile: deployment.use_custom_dockerfile ?? false,
			env_vars: deployment.env_vars ?? "",
			...(deployment.custom_url && { custom_url: deployment.custom_url }),
			deploymentTarget: "ec2",
			deployment_target_reason: "Using EC2.",
			...(deployment.core_deployment_info && deployment.features_infrastructure && deployment.final_notes && {
				core_deployment_info: deployment.core_deployment_info,
				features_infrastructure: deployment.features_infrastructure,
				final_notes: deployment.final_notes,
			}),
		};
		lastSavedSnapshotRef.current = JSON.stringify(initialPartial);
	}, [deployment, repo?.html_url, service_name, repo?.name]);

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
				// Always use EC2; keep reason from scan if available
				setDeploymentAnalysis(
					analysis
						? { target: "ec2", reason: analysis.reason, warnings: analysis.warnings }
						: { target: "ec2", reason: "Using EC2.", warnings: [] }
				);
				if (parsed_response) {
					const payload = {
						...form.getValues(),
						...parsed_response,
						deploymentTarget: "ec2",
					deployment_target_reason: analysis?.reason ?? "Using EC2.",
					};
					onScanComplete(payload);
				}
			})
	}


	const isDeployDisabled = React.useMemo(() => {
		const base = deployment ?? {};
		const effective: DeployConfig = {
			...base,
			features_infrastructure: projectMetadata?.features_infrastructure ?? deployment?.features_infrastructure,
			core_deployment_info: projectMetadata?.core_deployment_info ?? deployment?.core_deployment_info,
		} as DeployConfig;
		if (isDeploymentDisabled(effective)) return true;
		// No compatible deployment target (LLM set all platforms false)
		if (projectMetadata && !deploymentAnalysis) {
			const compat = (projectMetadata as AIGenProjectMetadata).service_compatibility;
			if (compat && typeof compat === "object" && Object.values(compat).every((v) => v === false))
				return true;
		}
		return false;
	}, [deployment, projectMetadata, deploymentAnalysis]);

	const featuresInfra = projectMetadata?.features_infrastructure;

	return (
		<>
			{projectMetadata && (
				<>
					{(featuresInfra?.uses_mobile ||
						featuresInfra?.is_library ||
						isDeployDisabled) && (
							<Alert variant="destructive" className="border-destructive/50 bg-destructive/10 text-foreground">
								<AlertTitle className="text-destructive/80">Deployment Disabled</AlertTitle>
								<AlertDescription className="text-muted-foreground">
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
						<Alert variant="destructive" className="border-destructive/50 bg-destructive/10 text-foreground">
							<AlertTitle className="text-destructive/80">Error!</AlertTitle>
							<AlertDescription className="text-muted-foreground">
								<p>
									❌ Build is required but no build command was detected. <strong>Deployment will fail.</strong>
								</p>
							</AlertDescription>
						</Alert>
					)}
					{
						projectMetadata.final_notes?.comment && (
							<Card className="my-4 border-border/60 bg-card/60">
								<CardHeader>
									<CardTitle className="text-foreground">💡 Final AI Notes</CardTitle>
								</CardHeader>
								<CardContent className="text-muted-foreground text-sm whitespace-pre-wrap">
									{projectMetadata?.final_notes?.comment}
								</CardContent>
							</Card>
						)
					}
					<Alert className="my-4 border-border/60 bg-card/40 text-muted-foreground">
						<AlertDescription className="text-sm">
							AI can make mistakes. Please verify the detected settings (commands, framework, etc.) before deploying for a higher success rate.
						</AlertDescription>
					</Alert>
				</>
			)}
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
					<p className="font-bold text-xl whitespace-nowrap my-4 text-foreground">Environment & Configuration</p>
					<Separator className="bg-border/60 h-px" />
					{editMode && (
						<div className="flex flex-row items-center gap-4 my-6 flex-wrap">
							<Button
								disabled={isAiFetching}
								variant="outline"
								onClick={handleAIBtn}
								className="border-border bg-transparent text-foreground hover:bg-secondary/50"
							>
								<RotateCw className={isAiFetching ? "animate-spin" : ""} />
								Smart Project Scan
							</Button>
							{deployment && deployment?.status != 'didnt_deploy' ? (
								<Button
									type="submit"
									disabled={isDeployDisabled || isDeploying}
									className="landing-build-blue hover:opacity-95 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
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
									disabled={(featuresInfra?.uses_mobile ||
										featuresInfra?.is_library ||
										isDeployDisabled) || isDeploying}
									repo={repo}
									branch={form.watch("branch") || deployment?.branch || "main"}
								/>
							)}
						</div>
					)}

					<div className="my-4 flex flex-row justify-start items-center space-x-4 flex-wrap gap-2">
						<span className="font-semibold min-w-37.5 text-foreground">Service Name:</span>
						{editMode ? (
							<FormField
								control={form.control}
								name="service_name"
								render={({ field }) => (
									<FormItem className="w-40">
										<FormControl>
											<Input {...field} className="border-border bg-background/60 text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary" />
										</FormControl>
									</FormItem>
								)}
							/>
						) : (
							<span className="text-muted-foreground w-40">{deployment?.service_name}</span>
						)}
						{projectMetadata?.core_deployment_info.language && <Badge variant="outline" className="border-border text-muted-foreground">Language: {projectMetadata?.core_deployment_info.language}</Badge>}
						{projectMetadata?.core_deployment_info.framework && <Badge variant="outline" className="border-border text-muted-foreground">Framework: {projectMetadata?.core_deployment_info.framework}</Badge>}

					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Custom URL */}
					<div className="my-4 flex flex-col space-y-2">
						<div className="flex flex-row justify-start items-center space-x-4">
							<span className="font-semibold min-w-37.5 text-foreground">Custom URL:</span>
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
																currentDeploymentId: deployment?.id ?? ""
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
											className="border-border bg-background/60 text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-primary"
											disabled={customUrlVerifying}
										/>
										<span className="text-muted-foreground text-sm whitespace-nowrap">.{process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN?.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}</span>
									</div>
									{customUrlVerifying && (
										<p className="text-xs text-muted-foreground">Verifying subdomain...</p>
									)}
									{customUrlStatus.type === 'success' && (
										<p className="text-xs text-teal-400">{customUrlStatus.message}</p>
									)}
									{customUrlStatus.type === 'owned' && (
										<p className="text-xs text-sky-400">{customUrlStatus.message}</p>
									)}
									{customUrlStatus.type === 'error' && (
										<div className="text-xs space-y-1">
											<p className="text-destructive/80">{customUrlStatus.message}</p>
											{customUrlStatus.alternatives && customUrlStatus.alternatives.length > 0 && (
												<div className="space-y-1">
													<p className="text-muted-foreground">Available alternatives:</p>
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
																className="px-2 py-1 text-teal-400 bg-teal-400/10 border border-teal-400/40 rounded hover:bg-teal-400/20 transition-colors"
															>
																{alt}
															</button>
														))}
													</div>
												</div>
											)}
										</div>
									)}
									<p className="text-xs text-muted-foreground/70">Press Enter to verify availability</p>
								</div>
							) : (
								<span className="text-muted-foreground">{deployment?.custom_url || 'Not set'}</span>
							)}
						</div>
					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Install Command */}
					<div className="my-4 flex flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Install Command:</span>
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
							<span className="text-muted-foreground w-40">{deployment?.core_deployment_info?.install_cmd}</span>
						)}
					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Build Command */}
					<div className="my-4 flex flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Build Command:</span>
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
							<span className="text-muted-foreground w-40">{deployment?.core_deployment_info?.build_cmd}</span>
						)}
					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Run Command */}
					<div className="my-4 flex flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Run Command:</span>
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
							<span className="text-muted-foreground w-40">{deployment?.core_deployment_info?.run_cmd}</span>
						)}
					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Branch */}
					<div className="my-4 flex flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Branch:</span>
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
							<span className="text-muted-foreground w-40">{deployment?.branch}</span>
						)}
					</div>
					<Separator className="bg-border/60 h-px" />


					{/* Working Directory */}
					<div className="my-4 flex flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Working Directory:</span>
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
							<span className="text-muted-foreground w-40">{deployment?.core_deployment_info?.workdir || '-'}</span>
						)}
					</div>
					<Separator className="bg-border/60 h-px" />

					{/* Custom Dockerfile */}
					<div className="my-4 hidden flex-row justify-start items-center space-x-4">
						<span className="font-semibold min-w-37.5 text-foreground">Custom Dockerfile:</span>
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
												<label className="block text-sm font-medium text-muted-foreground mb-1">
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
							<span className="text-muted-foreground w-40">
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
					<p className="font-bold text-xl whitespace-nowrap mt-10 text-foreground">Environment Variables</p>
					<div className="w-full mt-2">
						{editMode ? (
							<div className="space-y-3">
								<div className="max-h-75 overflow-y-auto space-y-2">
									{(envEntries.length > 0 ? envEntries : [{ name: "", value: "" }]).map((row, index) => (
										<div key={index} className="flex flex-wrap items-center gap-2">
											<div className="flex-1 min-w-35 space-y-1">
												<Label className="text-xs text-muted-foreground">Key</Label>
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
													className="bg-background/80 border-border/60 text-foreground placeholder:text-muted-foreground/70"
												/>
											</div>
											<div className="flex-1 min-w-35 space-y-1">
												<Label className="text-xs text-muted-foreground">Value</Label>
												<Input
													placeholder="e.g. production"
													value={row.value}
													onChange={(e) => {
														const displayRows = envEntries.length > 0 ? envEntries : [{ name: "", value: "" }];
														const next = displayRows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r));
														setEnvEntries(next.filter((r) => r.name.trim() || r.value.trim()).length ? next : []);
													}}
													className="bg-background/80 border-border/60 text-foreground placeholder:text-muted-foreground/70"
													autoComplete="off"
												/>
											</div>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="mt-6 text-muted-foreground hover:text-foreground shrink-0"
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
										className="border-border/60 text-foreground hover:bg-secondary/30"
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
										className="border-border/60 text-foreground hover:bg-secondary/30"
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
									<Table className="border max-h-25 overflow-y-auto border-border/60 p-2 rounded-md overflow-hidden">
										<TableHeader className="bg-card/80">
											<TableRow className="border-border/40 hover:bg-transparent">
												<TableHead className="text-foreground">Name</TableHead>
												<TableHead className="text-foreground">Value</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{parseEnvVarsToDisplay(deployment.env_vars).map((env, idx) => (
												<TableRow key={idx} className="border-border/40 hover:bg-secondary/30">
													<TableCell className="text-muted-foreground max-w-25 truncate">{env.name}</TableCell>
													<TableCell className="text-foreground font-mono">
														{"*".repeat(Math.min(env.value.length, 25))}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<span className="text-muted-foreground">-</span>
								)}
							</>
						)}
					</div>
				</form>
			</Form>
		</>
	)
}


