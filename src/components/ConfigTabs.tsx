import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay, sanitizeAndParseAIResponse } from "@/lib/utils";
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
import { RotateCw } from "lucide-react";
import type { SubmitHandler } from "react-hook-form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AIGenProjectMetadata, AWSDeploymentTarget, DeployConfig, DeployStep, repoType } from "@/app/types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";


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

export default function ConfigTabs(
	{ service_name, onSubmit, onScanComplete, editMode, isDeploying, id, serviceLogs, steps, deployment, repo }:
		{
			service_name: string, onSubmit: (data: FormSchemaType & Partial<AIGenProjectMetadata>) => void, onScanComplete: (data: FormSchemaType & Partial<AIGenProjectMetadata>) => void | Promise<void>, editMode: boolean, isDeploying: boolean, id: string,
			steps: DeployStep[], serviceLogs: { timestamp: string, message?: string }[], repo: repoType, deployment?: DeployConfig
		}) {

	const [dockerfile, setDockerfile] = useState<File | null>(null);

	const [isAiFetching, setAiFetching] = useState(false);
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

	const [dockerfileContent, setDockerfileContent] = useState<string | undefined>(deployment?.dockerfileContent);
	const branches = React.useRef(repo ? repo.branches.map(dat => dat.name) : ["main"]);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			url: repo?.html_url,
			service_name: service_name || repo?.name,
			branch: deployment?.branch || "main",
			install_cmd: deployment?.install_cmd || "",
			build_cmd: deployment?.build_cmd || "",
			run_cmd: deployment?.run_cmd || "",
			env_vars: deployment?.env_vars || "",
			workdir: deployment?.workdir || "",
			use_custom_dockerfile: deployment?.use_custom_dockerfile || false,
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
			install_cmd: deployment.install_cmd ?? "",
			build_cmd: deployment.build_cmd ?? "",
			run_cmd: deployment.run_cmd ?? "",
			env_vars: deployment.env_vars ?? "",
			workdir: deployment.workdir ?? "",
			use_custom_dockerfile: deployment.use_custom_dockerfile ?? false,
		});
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
	}, [deployment, repo?.html_url, service_name, repo?.name]);

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
					form.setValue('build_cmd', core_deployment_info.build_cmd ?? undefined);
					form.setValue('run_cmd', core_deployment_info.run_cmd);
					form.setValue('workdir', core_deployment_info.workdir ?? '');
				}
				const analysis = parsed_response ? selectDeploymentTargetFromMetadata(parsed_response) : null;
				if (analysis) {
					setDeploymentAnalysis(analysis);
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

	return (
		<>
			{deploymentAnalysis && (
				<Card className="mb-4 border-[#1e3a5f]/60 bg-[#132f4c]/60">
					<CardHeader className="pb-2">
						<CardTitle className="text-base font-medium flex items-center gap-2 text-[#e2e8f0]">
							Deployment target
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-1">
						<p className="font-semibold text-[#e2e8f0]">
							{deploymentAnalysis.target === "amplify" && "AWS Amplify"}
							{deploymentAnalysis.target === "elastic-beanstalk" && "AWS Elastic Beanstalk"}
							{deploymentAnalysis.target === "ecs" && "AWS ECS Fargate"}
							{deploymentAnalysis.target === "ec2" && "AWS EC2"}
							{deploymentAnalysis.target === "cloud-run" && "Google Cloud Run"}
						</p>
						<p className="text-sm text-[#94a3b8]">{deploymentAnalysis.reason}</p>
						{deploymentAnalysis.warnings.length > 0 && (
							<ul className="text-xs text-[#f59e0b] list-disc list-inside mt-1">
								{deploymentAnalysis.warnings.map((w, i) => (
									<li key={i}>{w}</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			)}
			{projectMetadata && (
				<>
					{(featuresInfra?.uses_websockets || featuresInfra?.uses_cron) && (
						<Alert variant="default" className="border-[#f59e0b]/50 bg-[#f59e0b]/10 text-[#e2e8f0]">
							<AlertTitle className="text-[#f59e0b]">Warning!</AlertTitle>
							<AlertDescription className="text-[#94a3b8]">
								<p>
									⚠️ This service uses WebSockets or Cron. Note: <strong>Cloud Run times out after 10 minutes</strong> of inactivity.
								</p>
							</AlertDescription>
						</Alert>
					)}

					{(featuresInfra?.uses_mobile ||
						featuresInfra?.is_library) && (
							<Alert variant="destructive" className="border-[#dc2626]/50 bg-[#dc2626]/10 text-[#e2e8f0]">
								<AlertTitle className="text-[#fca5a5]">Error!</AlertTitle>
								<AlertDescription className="text-[#94a3b8]">
									<p>
										❌ This project <strong>cannot be deployed</strong> to Cloud Run.
									</p>
									<ul className="list-disc pl-4 mt-2 text-sm">
										{featuresInfra?.uses_mobile && <li>It is a mobile app</li>}
										{featuresInfra?.cloud_run_compatible === false && <li>It is not compatible with Cloud Run</li>}
										{featuresInfra?.is_library && <li>It is a library, not a deployable service</li>}
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
						projectMetadata.final_notes.comment && (
							<Card className="my-4 border-[#1e3a5f]/60 bg-[#132f4c]/60">
								<CardHeader>
									<CardTitle className="text-[#e2e8f0]">💡 Final AI Notes</CardTitle>
								</CardHeader>
								<CardContent className="text-[#94a3b8] text-sm whitespace-pre-wrap">
									{projectMetadata?.final_notes.comment}
								</CardContent>
							</Card>
						)
					}
				</>
			)}
			<Tabs defaultValue="env_config">
				{
					isDeploying || (deployment && deployment?.status != 'didnt_deploy') ? (
						<TabsList className="bg-[#132f4c]/60 border border-[#1e3a5f]/60">
							<TabsTrigger value="env_config" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">Environment & Configuration</TabsTrigger>
							{deployment?.status != 'didnt_deploy' ? <TabsTrigger value="service_logs" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">Service Logs</TabsTrigger> : null}
							{isDeploying && <TabsTrigger value="deploy_logs" className="data-[state=active]:bg-[#1d4ed8] data-[state=active]:text-white text-[#94a3b8]">Deploy Logs</TabsTrigger>}
						</TabsList>
					) : null
				}
				<TabsContent value="env_config">
					<Form {...form}>
						<form onSubmit={form.handleSubmit((data) => {
							onSubmit({
								...data,
								...(projectMetadata ?? {}), // merge only if not null
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
									<Button type="submit" className="landing-build-blue hover:opacity-95 text-white">
										{(deployment && deployment?.status != 'didnt_deploy') ? "Save Changes" : "Deploy"}
									</Button>
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
									<span className="text-[#94a3b8] w-40">{deployment?.install_cmd}</span>
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
									<span className="text-[#94a3b8] w-40">{deployment?.build_cmd}</span>
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
									<span className="text-[#94a3b8] w-40">{deployment?.run_cmd}</span>
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

							{/* Working Directory */}
							<div className="my-4 flex flex-row justify-start items-center space-x-4">
								<span className="font-semibold min-w-[150px] text-[#e2e8f0]">Working Directory:</span>
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
									<span className="text-[#94a3b8] w-40">{deployment?.workdir || '-'}</span>
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
									<FormField
										control={form.control}
										name="env_vars"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Textarea {...field} rows={4} />
												</FormControl>
											</FormItem>
										)}
									/>
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
															<TableCell className="text-[#94a3b8]">{env.name}</TableCell>
															<TableCell className="text-[#e2e8f0]">{env.value}</TableCell>
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
					<p className="font-bold text-xl whitespace-nowrap my-4 text-[#e2e8f0]">Deploy Logs</p>
					<DeploymentAccordion steps={steps} />

				</TabsContent>
			</Tabs>
		</>
	)
}
