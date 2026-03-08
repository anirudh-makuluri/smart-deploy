import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay, buildEnvVarsString, parseEnvVarsToStore } from "@/lib/utils";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
} from "@/components/ui/form"
import { Alert, AlertDescription } from "./ui/alert"

import { RotateCw, Layers, Terminal, FileCode, Folder, Github, Plus, Trash2, Globe, CheckCircle2, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AIGenProjectMetadata, DeployConfig, repoType, SDArtifactsResponse } from "@/app/types";
import ScanProgress from "@/components/ScanProgress";
import PostScanResults from "@/components/PostScanResults";

export type FormSchemaType = z.infer<typeof formSchema>

export type CombinedSubmitType = FormSchemaType & AIGenProjectMetadata;

export const formSchema = z.object({
	branch: z.string().min(1, { message: "Branch is required" }),
	env_vars: z.string().optional(),
	custom_url: z.string().optional(),
})

export default function ConfigTabs(
	{ onSubmit, onConfigChange, deployment, branches: branchesProp, repoFullName }:
		{
			repoFullName: string,
			onSubmit: (data: FormSchemaType & Partial<AIGenProjectMetadata> & { commitSha?: string }) => void,
			onConfigChange: (partial: Partial<DeployConfig>) => void,
			deployment: DeployConfig, branches?: string[]
		}) {

	const [envEntries, setEnvEntries] = useState<{ name: string; value: string }[]>(() =>
		parseEnvVarsToDisplay(deployment.env_vars ?? "")
	);
	const [customUrlVerifying, setCustomUrlVerifying] = useState(false);
	const [customUrlStatus, setCustomUrlStatus] = useState<{ type: 'success' | 'error' | 'owned' | null; message?: string; alternatives?: string[] }>({ type: null });
	const [scanMode, setScanMode] = useState<"form" | "scanning" | "results">("form");
	const [scanResults, setScanResults] = useState<SDArtifactsResponse | null>(null);
	const [scanStartTime, setScanStartTime] = useState<number>(0);
	const [scanDuration, setScanDuration] = useState<number>(0);
	const onConfigChangeRef = React.useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;


	const form = useForm<FormSchemaType>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			branch: deployment.branch,
			env_vars: deployment.env_vars ?? "",
			custom_url: deployment.custom_url ?? "",
		},
	})

	const handleInfraChange = (updatedResults: SDArtifactsResponse) => {
		setScanResults(updatedResults);

		const values = form.getValues();
		const envString = buildEnvVarsString(envEntries);

		onConfigChangeRef.current({
			branch: values.branch,
			custom_url: values.custom_url,
			env_vars: parseEnvVarsToStore(envString),
			...updatedResults
		});
	};

	const verifySubdomain = async (subdomainInput: string) => {
		if (!subdomainInput) return;
		const subdomain = subdomainInput.replace(/^https?:\/\//, "").split(".")[0];
		if (!subdomain) return;

		setCustomUrlVerifying(true);
		try {
			const res = await fetch("/api/verify-dns", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					subdomain,
					repoName: deployment.repo_name,
					serviceName: deployment.service_name
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
						message: `Available: ${data.customUrl}`
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
	};

	useEffect(() => {
		if (!deployment.custom_url) {
			verifySubdomain(deployment.service_name);
		}
	}, []);

	function handleAIBtn() {
		setScanStartTime(Date.now());
		setScanMode("scanning");
	}

	if (scanMode === "scanning") {
		return (
			<ScanProgress
				repoFullName={repoFullName}
				branch={form.getValues("branch")}
				onComplete={(data) => {
					console.log("ConfigTabs: onComplete called with data:", data);
					console.log("ConfigTabs: scanStartTime was:", scanStartTime);
					setScanDuration(Date.now() - scanStartTime);
					setScanResults(data);
					setScanMode("results");

					// Immediate save after scan
					if (deployment?.id) {
						console.log("ConfigTabs: Auto-saving config for deployment:", deployment.id);
						onConfigChangeRef.current?.({
							id: deployment.id,
							...form.getValues(),
							env_vars: parseEnvVarsToStore(buildEnvVarsString(envEntries)),
							deploymentTarget: "ec2",
							...data
						});
					}
				}}
				onCancel={() => setScanMode("form")}
			/>
		);
	}

	if (scanMode === "results" && scanResults) {
		return (
			<PostScanResults
				results={scanResults}
				onUpdateResults={handleInfraChange}
				scanTime={scanDuration}
				deployment={deployment}
				onStartDeployment={() => {
					//TODO: IMPLEMENT PROPERLY
				}}
				onCancel={() => setScanMode("form")}
			/>
		);
	}

	return (
		<>
			<Form {...form}>
				<form onSubmit={form.handleSubmit((data) => {
					const envString = buildEnvVarsString(envEntries);
					onSubmit({
						...data,
						env_vars: envString,
					} as any);
				})} className="flex flex-col gap-6">

					{/* PROJECT SOURCE */}
					<div className="space-y-3 pt-2">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-4">
							<Folder className="size-3.5" />
							Project Source
						</div>

						<div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-center gap-4">
							<div className="bg-primary/10 p-2.5 rounded-lg shrink-0">
								<Github className="size-6 text-primary" />
							</div>
							<div className="flex flex-col">
								<span className="font-semibold text-foreground text-sm">{deployment.service_name != "." ? deployment.service_name + "@" : ""}{deployment.repo_name}</span>
								<span className="text-xs text-muted-foreground/60 italic">{deployment.url}</span>
							</div>
						</div>

						<div className="space-y-5 mt-6">
							<div className="space-y-2">
								<label className="text-xs font-semibold text-muted-foreground/80">Deployment Branch</label>
								<FormField
									control={form.control}
									name="branch"
									render={({ field }) => (
										<FormItem>
											<FormControl>
												<Select
													onValueChange={field.onChange}
													defaultValue={field.value}
												>
													<SelectTrigger className="w-full h-11 bg-white/[0.03] border-white/5 text-foreground rounded-lg focus:ring-primary/20">
														<SelectValue placeholder="Select a branch" />
													</SelectTrigger>
													<SelectContent className="bg-[#121019] border-white/10">
														{(branchesProp || ["main"]).map((branch) => (
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
							</div>


						</div>
					</div>

					{/* CUSTOM URL */}
					<div className="space-y-4 pt-4 border-t border-white/5">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
							<Globe className="size-3.5" />
							Custom Domain
						</div>
						<div className="space-y-3 pl-1">
							<FormField
								control={form.control}
								name="custom_url"
								render={({ field }) => (
									<FormItem>
										<FormControl>
											<div className="flex rounded-lg overflow-hidden border border-white/5 bg-white/[0.03] transition-all focus-within:ring-1 focus-within:ring-primary/20">
												<Input
													{...field}
													placeholder="my-app"
													className="border-0 bg-transparent h-11 rounded-none focus-visible:ring-0 text-foreground placeholder:text-muted-foreground/30"
													onBlur={(e) => {
														field.onBlur();
														if (e.target.value) {
															verifySubdomain(e.target.value);
														}
													}}
													onChange={(e) => {
														field.onChange(e);
														setCustomUrlStatus({ type: null });
													}}
												/>
											</div>
										</FormControl>
									</FormItem>
								)}
							/>

							{customUrlVerifying && (
								<div className="flex items-center gap-2 text-xs text-muted-foreground/60 animate-pulse">
									<RotateCw className="size-3 animate-spin" />
									Verifying domain availability...
								</div>
							)}

							{customUrlStatus.type && !customUrlVerifying && (
								<Alert className={`py-2 px-3 ${customUrlStatus.type === 'error' ? 'bg-destructive/10 border-destructive/20 text-destructive' :
									customUrlStatus.type === 'owned' ? 'bg-primary/10 border-primary/20 text-primary' :
										'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
									}`}>
									<div className="flex items-center gap-2">
										{customUrlStatus.type === 'error' ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
										<AlertDescription className="text-xs font-medium m-0">
											{customUrlStatus.message}
										</AlertDescription>
									</div>
								</Alert>
							)}
						</div>
					</div>

					{/* ENVIRONMENT VARIABLES */}
					<div className="space-y-4 pt-4 border-t border-white/5">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
								<Layers className="size-3.5" />
								Environment Variables
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-primary/10"
								onClick={() => setEnvEntries([...envEntries, { name: "", value: "" }])}
							>
								<Plus className="size-3 mr-1" />
								Add Variable
							</Button>
						</div>

						<div className="space-y-3">
							<div className="bg-[#121019] border border-white/5 rounded-xl overflow-hidden shadow-2xl">
								{/* Header */}
								<div className="grid grid-cols-[1fr,1.5fr,auto] gap-px bg-white/5 border-b border-white/5">
									<div className="px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Key</div>
									<div className="px-4 py-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Value</div>
									<div className="w-[50px]"></div>
								</div>

								{/* Body */}
								<div className="divide-y divide-white/5">
									{envEntries.map((entry, index) => (
										<div key={index} className="grid grid-cols-[1fr,1.5fr,auto] gap-px bg-transparent transition-colors hover:bg-white/[0.02]">
											<div className="px-2 py-1.5 flex items-center">
												<Input
													value={entry.name}
													onChange={(e) => {
														const newEntries = [...envEntries];
														newEntries[index].name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
														setEnvEntries(newEntries);
													}}
													placeholder="API_KEY"
													className="h-8 bg-transparent border-0 focus-visible:ring-1 focus-visible:ring-primary/30 text-xs text-foreground placeholder:text-muted-foreground/30 px-2 font-mono"
												/>
											</div>
											<div className="px-2 py-1.5 flex items-center border-l border-white/5">
												<Input
													value={entry.value}
													onChange={(e) => {
														const newEntries = [...envEntries];
														newEntries[index].value = e.target.value;
														setEnvEntries(newEntries);
													}}
													type="password"
													placeholder="sk_live_..."
													className="h-8 bg-transparent border-0 focus-visible:ring-1 focus-visible:ring-primary/30 text-xs text-foreground placeholder:text-muted-foreground/30 px-2 font-mono"
												/>
											</div>
											<div className="px-2 py-1.5 flex items-center justify-center border-l border-white/5 w-[50px]">
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
													onClick={() => {
														const newEntries = envEntries.filter((_, i) => i !== index);
														setEnvEntries(newEntries);
													}}
												>
													<Trash2 className="size-3.5" />
												</Button>
											</div>
										</div>
									))}

									{envEntries.length === 0 && (
										<div className="px-4 py-8 text-center text-sm text-muted-foreground/60 border-l border-white/5">
											No environment variables configured.
										</div>
									)}
								</div>
							</div>
						</div>
					</div>

					{/* SMART PROJECT SCAN BUTTON */}
					<div className="py-2">
						<Button
							type="button"
							onClick={handleAIBtn}
							className="w-full h-11 text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all rounded-lg"
						>
							Smart Project Scan
						</Button>
					</div>

					{/* BUILD & RUNTIME COMMANDS */}
					<div className="space-y-6 mt-6 transition-all duration-500 opacity-20 pointer-events-none grayscale">
						<div className="space-y-3">
							<div className="flex items-center gap-3">
								<span className="text-[9px] font-bold text-primary px-1.5 py-0.5 border border-primary/30 rounded bg-primary/5 uppercase tracking-tighter whitespace-nowrap">[ Scan Required ]</span>
								<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
									<Terminal className="size-3.5" />
									Build & Runtime Commands
								</div>
							</div>
						</div>

						<div className="space-y-3">
							<div className="flex items-center gap-3">
								<span className="text-[9px] font-bold text-primary px-1.5 py-0.5 border border-primary/30 rounded bg-primary/5 uppercase tracking-tighter whitespace-nowrap">[ Scan Required ]</span>
								<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">
									<FileCode className="size-3.5" />
									Infrastructure Files
								</div>
							</div>
							<div className="flex gap-3">
								{[
									{ label: 'Dockerfile' },
									{ label: 'Compose' },
									{ label: 'Nginx' }
								].map((file) => (
									<div
										key={file.label}
										className={`flex-1 h-11 rounded-lg border flex items-center justify-center text-[10px] font-extrabold uppercase tracking-[0.2em] transition-all border-white/5 bg-white/[0.02] text-muted-foreground`}
									>
										{file.label}
									</div>
								))}
							</div>
						</div>
					</div>
				</form>
			</Form>
		</>
	)
}
