"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay, buildEnvVarsString, parseEnvVarsToStore } from "@/lib/utils";
import { toast } from "sonner";

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

import { RotateCw, Layers, Folder, Globe, CheckCircle2, AlertTriangle, Settings2, Sparkles, GitBranch, CircleDot, Cpu } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { DeployConfig } from "@/app/types";
import EnvVarSheet from "@/components/EnvVarSheet";
import config from "@/config.client";
import {
	DEFAULT_EC2_INSTANCE_TYPE,
	EC2_INSTANCE_TYPE_PRESETS,
	formatApproxEc2PriceCompact,
} from "@/lib/aws/ec2InstanceTypes";
import { updateCustomDomain, verifyDns } from "@/lib/graphqlClient";
import { useAppData } from "@/store/useAppData";

export type FormSchemaType = z.infer<typeof formSchema>

export const formSchema = z.object({
	branch: z.string().min(1, { message: "Branch is required" }),
	env_vars: z.string().optional(),
	custom_url: z.string().optional(),
})

type ConfigTabsProps = {
	onConfigChange: (partial: Partial<DeployConfig>) => void;
	deployment: DeployConfig;
	branches?: string[];
	repoFullName: string;
	onStartScan?: () => void;
};

const DOMAIN_SUFFIX = config.NEXT_PUBLIC_VERCEL_DOMAIN || "smart-deploy.xyz";

export default function ConfigTabs({
	onConfigChange,
	deployment,
	branches: branchesProp,
	repoFullName,
	onStartScan
}: ConfigTabsProps) {
	const [envEntries, setEnvEntries] = useState<{ name: string; value: string }[]>(() =>
		parseEnvVarsToDisplay(deployment.env_vars ?? "")
	);

	const updateDeploymentById = useAppData((state) => state.updateDeploymentById);
	const [isEnvSheetOpen, setIsEnvSheetOpen] = useState(false);
	const [customUrlVerifying, setCustomUrlVerifying] = useState(false);
	const [customUrlStatus, setCustomUrlStatus] = useState<{ type: 'success' | 'error' | 'owned' | null; message?: string; alternatives?: string[] }>({ type: null });

	const onConfigChangeRef = React.useRef(onConfigChange);
	onConfigChangeRef.current = onConfigChange;

	const initialSubdomain = React.useMemo(() => {
		let raw = (deployment as any).custom_url || "";
		if (!raw) return "";
		// Strip protocol
		raw = raw.replace(/^https?:\/\//, "");
		// Strip suffix
		if (raw.endsWith(`.${DOMAIN_SUFFIX}`)) {
			return raw.slice(0, -(DOMAIN_SUFFIX.length + 1));
		}
		return raw.split(".")[0];
	}, [deployment, DOMAIN_SUFFIX]);

	const form = useForm<FormSchemaType>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			branch: deployment.branch,
			env_vars: deployment.env_vars ?? "",
			custom_url: initialSubdomain,
		},
	})

	const customUrlValue = form.watch("custom_url");
	const [customUrlSaving, setCustomUrlSaving] = useState(false);
	const [isCustomUrlDirty, setIsCustomUrlDirty] = useState(false);


	useEffect(() => {
		setIsCustomUrlDirty(customUrlValue !== initialSubdomain);
	}, [customUrlValue, initialSubdomain]);

	useEffect(() => {
		form.setValue("custom_url", initialSubdomain, { shouldDirty: false });
		setIsCustomUrlDirty(false);
		setCustomUrlStatus({ type: null });
	}, [initialSubdomain, form]);

	const getCustomUrlFromSubdomain = (subdomain: string) =>
		subdomain ? `https://${subdomain}.${DOMAIN_SUFFIX}` : "";

	const handleSaveCustomUrl = async () => {
		if (!deployment) return;
		const raw = form.getValues("custom_url");
		if (!raw) {
			return
		}
		const finalUrl = getCustomUrlFromSubdomain(raw.trim());
		const previousUrl = (deployment.custom_url || "").trim();
		if (finalUrl === previousUrl) {
			setIsCustomUrlDirty(false);
			return;
		}

		setCustomUrlSaving(true);
		try {
			const data = await updateCustomDomain(deployment.repo_name, deployment.service_name, finalUrl);

			updateDeploymentById({
				repo_name: deployment.repo_name,
				service_name: deployment.service_name,
				custom_url: finalUrl,
			});
			setIsCustomUrlDirty(false);
			setCustomUrlStatus({
				type: finalUrl ? "success" : null,
				message: finalUrl ? data?.message || `Custom domain saved: ${finalUrl}` : undefined,
			});
			if (finalUrl) {
				toast.success(data?.message || "Custom domain saved");
			} else {
				toast.success("Custom domain cleared");
			}
		} catch (error: any) {
			const message = error?.message ?? "Failed to update custom domain";
			setCustomUrlStatus({ type: "error", message });
			toast.error(message);
		} finally {
			setCustomUrlSaving(false);
		}
	};

	const handleCancelCustomUrl = () => {
		form.setValue("custom_url", initialSubdomain, { shouldDirty: false });
		setIsCustomUrlDirty(false);
		setCustomUrlStatus({ type: null });
	};

	// Auto-save logic
	const watchedBranch = form.watch("branch");

	const isMounted = React.useRef(false);
	useEffect(() => {
		if (!isMounted.current) {
			isMounted.current = true;
			return;
		}
		if (watchedBranch !== deployment.branch) {
			onConfigChange({ branch: watchedBranch });
		}
	}, [watchedBranch, deployment.branch, onConfigChange]);

	useEffect(() => {
		const envString = buildEnvVarsString(envEntries);
		if (envString === deployment.env_vars) return;

		const timeoutId = setTimeout(() => {
			onConfigChange({ env_vars: envString });
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [envEntries, deployment.env_vars, onConfigChange]);

	const verifySubdomain = async (subdomain: string) => {
		if (!subdomain) return;

		setCustomUrlVerifying(true);
		try {
			const data = await verifyDns(subdomain, deployment.repo_name, deployment.service_name);

			if (data.available) {
				const availableSubdomain = (data.customUrl || "").replace(/^https?:\/\//, "").split(".")[0];
				if (data.isOwned) {
					setCustomUrlStatus({
						type: 'owned',
						message: `Current: ${data.customUrl}`
					});
				} else {
					setCustomUrlStatus({
						type: 'success',
						message: `Available: ${data.customUrl}`
					});
				}
				form.setValue("custom_url", availableSubdomain);
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
		const currentSub = form.getValues("custom_url");
		if (!currentSub) {
			const serviceSub = (deployment.service_name && deployment.service_name !== ".") ? `-${deployment.service_name}` : "";
			const defaultSubdomain = `${deployment.repo_name}${serviceSub}`;
			form.setValue("custom_url", defaultSubdomain);
			verifySubdomain(defaultSubdomain);
		} else {
			verifySubdomain(currentSub);
		}
	}, []);

	const hasScanResults = !!deployment.scan_results;

	const ec2InstanceOptions = React.useMemo(() => {
		const v = deployment.awsEc2InstanceType?.trim();
		const list: string[] = [...EC2_INSTANCE_TYPE_PRESETS];
		if (v && !list.some((x) => x === v)) list.unshift(v);
		return list;
	}, [deployment.awsEc2InstanceType]);

	const ec2InstanceValue = deployment.awsEc2InstanceType?.trim() || DEFAULT_EC2_INSTANCE_TYPE;

	const branchSelectOptions = React.useMemo(() => {
		const fromRepo = (branchesProp ?? []).filter(Boolean);
		const current = deployment.branch?.trim();
		if (current && !fromRepo.includes(current)) {
			return [current, ...fromRepo];
		}
		return fromRepo.length > 0 ? fromRepo : current ? [current] : [];
	}, [branchesProp, deployment.branch]);

	React.useEffect(() => {
		form.setValue("branch", deployment.branch ?? "", { shouldDirty: false });
	}, [deployment.branch, deployment.repo_name, deployment.service_name, form.setValue]);

	return (
		<Form {...form}>
			<div className="flex flex-col gap-10 max-w-2xl mx-auto">

				{/* PROJECT SOURCE */}
				<div className="space-y-4">
					<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
							<Folder className="size-3.5" />
							Project Source
						</div>
						<p className="text-[10px] text-muted-foreground/40 leading-relaxed">Repository and service identifiers</p>
					</div>

					<div className="flex flex-col gap-4">
						<div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 flex items-center gap-4 group hover:border-white/10 transition-colors">
							<div className="bg-primary/10 p-3 rounded-xl shrink-0 group-hover:scale-110 transition-transform">
								<CircleDot className="size-6 text-primary" />
							</div>
							<div className="flex flex-col overflow-hidden">
								<span className="font-bold text-foreground text-sm truncate">{deployment.service_name != "." ? deployment.service_name + "@" : ""}{deployment.repo_name}</span>
								<a
									href={`https://github.com/${repoFullName}`}
									target="_blank"
									rel="noopener noreferrer"
									className="text-[10px] text-muted-foreground/40 font-mono truncate hover:text-primary transition-colors flex items-center gap-1"
								>
									https://github.com/{repoFullName}
									<Globe className="size-2.5" />
								</a>
							</div>
						</div>
					</div>
				</div>

				{/* DEPLOYMENT BRANCH */}
				<div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pt-10 border-t border-white/5">
					<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
							<GitBranch className="size-3.5" />
							Deployment Branch
						</div>
						<p className="text-[10px] text-muted-foreground/40 leading-relaxed">The branch to use for automatic builds</p>
					</div>
					<div className="w-full max-w-sm">
						<FormField
							control={form.control}
							name="branch"
							render={({ field }) => (
								<FormItem>
									<FormControl>
										{branchSelectOptions.length === 0 ? (
											<p className="text-sm text-muted-foreground py-2.5 px-1">Loading branches…</p>
										) : (
											<Select value={field.value} onValueChange={field.onChange}>
												<SelectTrigger className="w-full h-11 bg-white/[0.02] border-white/5 text-foreground rounded-xl focus:ring-primary/20 hover:border-white/10 transition-colors px-4">
													<div className="flex items-center gap-2.5 w-full">
														<GitBranch className="size-3.5 text-muted-foreground/40 shrink-0" />
														<div className="text-sm font-medium">
															<SelectValue placeholder="Select a branch" />
														</div>
													</div>
												</SelectTrigger>
												<SelectContent className="bg-[#0A0A0F] border-white/10">
													{branchSelectOptions.map((branchName) => (
														<SelectItem key={branchName} value={branchName}>
															{branchName}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									</FormControl>
								</FormItem>
							)}
						/>
					</div>
				</div>

				{/* EC2 INSTANCE TYPE */}
				<div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pt-10 border-t border-white/5">
					<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
							<Cpu className="size-3.5" />
							EC2 instance type
						</div>
						<p className="text-[10px] text-muted-foreground/40 leading-relaxed">
							Size for new EC2 instances. Redeploying to an existing instance does not resize it—change type in AWS or replace the instance.
						</p>
						<p className="text-[10px] text-muted-foreground/30 leading-relaxed mt-1">
							Prices are approximate on-demand Linux in <span className="text-muted-foreground/50">us-west-2</span> (EBS &amp; transfer extra; other regions differ).
						</p>
					</div>
					<div className="w-full max-w-sm space-y-2">
						<Select
							value={ec2InstanceValue}
							onValueChange={(value) => onConfigChange({ awsEc2InstanceType: value })}
						>
							<SelectTrigger className="w-full h-auto min-h-11 py-2 bg-white/[0.02] border-white/5 text-foreground rounded-xl focus:ring-primary/20 hover:border-white/10 transition-colors px-4 whitespace-normal *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:items-start *:data-[slot=select-value]:text-left [&_[data-slot=select-value]]:w-full">
								<div className="flex items-start gap-2.5 w-full min-w-0 text-left">
									<Cpu className="size-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
									<SelectValue placeholder="Instance type" />
								</div>
							</SelectTrigger>
							<SelectContent className="bg-[#0A0A0F] border-white/10 max-h-80">
								{ec2InstanceOptions.map((t) => {
									const priceLine = formatApproxEc2PriceCompact(t);
									return (
										<SelectItem key={t} value={t} className="py-2">
											<div className="flex flex-col gap-0.5 text-left">
												<span className="font-medium">{t}</span>
												{priceLine ? (
													<span className="text-[10px] text-muted-foreground/80 font-normal">{priceLine}</span>
												) : (
													<span className="text-[10px] text-muted-foreground/50 font-normal">
														Estimate unavailable — see AWS pricing
													</span>
												)}
											</div>
										</SelectItem>
									);
								})}
							</SelectContent>
						</Select>
					</div>
				</div>

				{/* CUSTOM URL */}
				<div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pt-10 border-t border-white/5">
					<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
							<Globe className="size-3.5" />
							Custom Domain
						</div>
						<p className="text-[10px] text-muted-foreground/40 leading-relaxed">Public URL for accessing your application</p>
					</div>
					<div className="w-full max-w-sm space-y-3">
						<FormField
							control={form.control}
							name="custom_url"
							render={({ field }) => (
								<FormItem>
									<FormControl>
										<div className="relative group ">
											<div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/30 font-mono text-[10px] group-focus-within:text-primary/50 transition-colors pointer-events-none">https://</div>
										<Input
											{...field}
											placeholder="my-cool-app"
											className="pl-14 pr-32 h-11 bg-white/2 border-white/5 rounded-xl focus-visible:ring-primary/20 text-foreground font-medium text-sm placeholder:text-muted-foreground/10 hover:border-white/10 transition-colors"
											// onBlur={(e) => {
											// 	field.onBlur();												
											// 	if (e.target.value) {
											// 		verifySubdomain(e.target.value.trim());
											// 	}
											// }}
											onChange={(e) => {
												field.onChange(e.target.value);
												setCustomUrlStatus({ type: null });
											}}
										/>
											<div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
												<span className="text-muted-foreground/20 font-mono text-[10px]">.{DOMAIN_SUFFIX}</span>
												{customUrlVerifying && <RotateCw className="size-3 animate-spin text-primary" />}
												{!customUrlVerifying && customUrlStatus.type === 'success' && <CheckCircle2 className="size-3 text-emerald-500" />}
												{!customUrlVerifying && customUrlStatus.type === 'error' && <AlertTriangle className="size-3 text-destructive" />}
											</div>
										</div>
									</FormControl>
								</FormItem>
							)}
						/>

						{customUrlStatus.type && !customUrlVerifying && (
							<Alert className={`py-2 px-3 rounded-lg border-none ${customUrlStatus.type === 'error' ? 'bg-destructive/10 text-destructive' :
								customUrlStatus.type === 'owned' ? 'bg-primary/10 text-primary' :
									'bg-emerald-500/10 text-emerald-500'
								}`}>
								<AlertDescription className="text-[10px] font-bold tracking-tight">
									{customUrlStatus.message}
								</AlertDescription>
							</Alert>
						)}
						<div className="flex flex-wrap items-center gap-2 pt-3">
							<Button
								type="button"
								variant="ghost"
								className="text-[11px] h-9 px-3"
								onClick={handleCancelCustomUrl}
								disabled={!isCustomUrlDirty || customUrlSaving}
							>
								Cancel
							</Button>
							<Button
								type="button"
								className="text-[11px] h-9 px-4"
								onClick={handleSaveCustomUrl}
								disabled={!isCustomUrlDirty || customUrlSaving}
							>
								{customUrlSaving ? "Saving…" : "Save"}
							</Button>
							<p className="text-[10px] text-muted-foreground/70">
								Saving reconfigures the ALB + Vercel DNS record without redeploying.
							</p>
						</div>
					</div>
				</div>

				<div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pt-10 border-t border-white/5">
					<div className="flex flex-col gap-1 w-full md:w-48 shrink-0">
						<div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
							<Layers className="size-3.5" />
							Environment Variables
						</div>
						<p className="text-[10px] text-muted-foreground/40 leading-relaxed">Secure credentials and runtime configuration</p>
					</div>
					<div className="w-full max-w-sm">
						<div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 group hover:border-white/10 transition-colors">
							<div className="flex flex-col gap-0.5">
								<span className="text-sm font-bold text-foreground flex items-center gap-2">
									{envEntries.length || 0} Secret Keys
									<span className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] text-muted-foreground/60">Configured</span>
								</span>
								<span className="text-[10px] text-muted-foreground/40 font-medium">
									API keys & credentials
								</span>
							</div>
							<Button
								type="button"
								variant="outline"
								className="bg-primary/10 border-primary/20 hover:bg-primary/20 text-primary h-9 px-4 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 text-[10px]"
								onClick={() => setIsEnvSheetOpen(true)}
							>
								<Settings2 className="size-3.5" />
								Edit
							</Button>
						</div>
					</div>
				</div>

				<EnvVarSheet
					open={isEnvSheetOpen}
					onOpenChange={setIsEnvSheetOpen}
					entries={envEntries}
					onEntriesChange={setEnvEntries}
				/>

				{/* SMART SCAN PROMPT */}
				{!hasScanResults && (
					<div className="p-8 rounded-3xl border border-dashed border-white/10 bg-gradient-to-br from-primary/5 via-transparent to-transparent flex flex-col items-center text-center gap-6">
						<div className="size-16 rounded-2xl bg-primary/20 flex items-center justify-center">
							<Sparkles className="size-8 text-primary" />
						</div>
						<div className="space-y-2">
							<h3 className="text-xl font-bold text-foreground">Awaiting Blueprint</h3>
							<p className="text-sm text-muted-foreground max-w-sm mx-auto">
								Run a Smart Scan to automatically detect your tech stack, generate optimized Dockerfiles, and audit infrastructure requirements.
							</p>
						</div>
						<Button
							type="button"
							onClick={onStartScan}
							className="h-12 px-10 rounded-2xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xl shadow-primary/20 flex items-center gap-2 group"
						>
							<Sparkles className="size-5 group-hover:animate-spin" />
							Blueprint Application
						</Button>
					</div>
				)}


			</div>
		</Form >
	)
}
