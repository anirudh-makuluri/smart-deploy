import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseEnvVarsToDisplay,sanitizeAndParseAIResponse } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
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
import { DeployConfig, DeployStep, repoType } from "@/app/types";


type FormSchemaType = z.infer<typeof formSchema>

export const formSchema = z.object({
	url: z.string().url({ message: "Must be a valid URL" }),
	service_name: z.string(),
	branch: z.string().min(1, { message: "Branch is required" }),
	install_cmd: z.string().optional(),
	build_cmd: z.string().optional(),
	run_cmd: z.string().optional(),
	env_vars: z.string().optional(),
	workdir: z.string().optional(),
	use_custom_dockerfile: z.boolean()
})

export default function ConfigTabs(
	{ service_name, onSubmit, editMode, isDeploying, id, serviceLogs, steps, deployment, repo }:
		{ service_name: string, onSubmit: SubmitHandler<FormSchemaType>, editMode: boolean, isDeploying : boolean, id: string, 
			steps: DeployStep[], serviceLogs: {timestamp : string, message ?: string}[], repo : repoType, deployment ?: DeployConfig }) {

	const [dockerfile, setDockerfile] = useState<File | null>(null);

	const [isAiFetching, setAiFetching] = useState(false);

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

	function handleAIBtn() {
		setAiFetching(true);

		if (!repo?.full_name || !repo.default_branch) return;

		fetch('/api/llm', {
			method: "POST",
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ full_name: repo.full_name, branch: repo.default_branch })
		}).then(res => res.json())
			.then((response) => {
				setAiFetching(false);
				console.log(response)
				const parsed_response = sanitizeAndParseAIResponse(response)
				console.log(parsed_response);
				const core_deployment_info = parsed_response?.core_deployment_info;
				if (core_deployment_info) {
					form.setValue('install_cmd', core_deployment_info.install_cmd)
					form.setValue('build_cmd', core_deployment_info.build_cmd || undefined)
					form.setValue('run_cmd', core_deployment_info.run_cmd)
					form.setValue('workdir', core_deployment_info.workdir || '/app')
				}
			})
	}


	return (
		<Tabs defaultValue="env_config">
			{
				isDeploying || deployment ? (
					<TabsList>
						<TabsTrigger value="env_config">Environment & Configuration</TabsTrigger>
						{deployment ? <TabsTrigger value="service_logs">Service Logs</TabsTrigger> : null}
						{isDeploying && <TabsTrigger value="deploy_logs">Deploy Logs</TabsTrigger>}
					</TabsList>
				) : null
			}
			<TabsContent value="env_config">
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="h-full py-4 px-20">
						<p className="font-bold text-xl whitespace-nowrap my-4">Environment & Configuration</p>
						<Separator className="bg-slate-700 h-[1px]" />
						{editMode && (
							<div className="flex flex-row items-center space-x-10 my-6">
								<Button disabled={isAiFetching}
									variant={'outline'} onClick={handleAIBtn}>
									<RotateCw className={(isAiFetching ? "spin-animation" : "")} />
									<p>Let AI fill this for you</p>
								</Button>
								<Button type="submit">
									{deployment ? "Save Changes" : "Deploy"}
								</Button>
							</div>
						)}

						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Service Name:</span>
							{editMode ? (
								<FormField
									control={form.control}
									name="service_name"
									render={({ field }) => (
										<FormItem className="w-40">
											<FormControl>
												<Input {...field} />
											</FormControl>
										</FormItem>
									)}
								/>
							) : (
								<span className="text-slate-400 w-40">{deployment?.service_name}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Install Command */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Install Command:</span>
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
								<span className="text-slate-400 w-40">{deployment?.install_cmd}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Build Command */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Build Command:</span>
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
								<span className="text-slate-400 w-40">{deployment?.build_cmd}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Run Command */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Run Command:</span>
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
								<span className="text-slate-400 w-40">{deployment?.run_cmd}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Branch */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Branch:</span>
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
								<span className="text-slate-400 w-40">{deployment?.branch}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Working Directory */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Working Directory:</span>
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
								<span className="text-slate-400 w-40">{deployment?.workdir || '-'}</span>
							)}
						</div>
						<Separator className="bg-slate-700 h-[1px]" />

						{/* Custom Dockerfile */}
						<div className="w-96 my-4 flex flex-row justify-between items-center">
							<span className="font-semibold">Custom Dockerfile:</span>
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
													<label className="block text-sm font-medium text-gray-700 mb-1">
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
								<span className="text-slate-400 w-40">
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
						<p className="font-bold text-xl whitespace-nowrap mt-10">Environment Variables</p>
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
										<Table className="border p-2 rounded-md overflow-hidden">
											<TableHeader className="bg-card">
												<TableRow>
													<TableHead>Name</TableHead>
													<TableHead>Value</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{parseEnvVarsToDisplay(deployment.env_vars).map((env, idx) => (
													<TableRow key={idx} >
														<TableCell>{env.name}</TableCell >
														<TableCell>{env.value}</TableCell >
													</TableRow>
												))}
											</TableBody>
										</Table>
									) : (
										<span className="text-slate-400">-</span>
									)}
								</>
							)}
						</div>
					</form>
				</Form>
			</TabsContent>
			<TabsContent value="service_logs">
				<p className="font-bold text-xl whitespace-nowrap my-4">Service Logs</p>
				<ServiceLogs logs={serviceLogs} />
			</TabsContent>
			<TabsContent value="deploy_logs">
				<p className="font-bold text-xl whitespace-nowrap my-4">Deploy Logs</p>
				<DeploymentAccordion steps={steps} />
				
			</TabsContent>
		</Tabs>
	)
}
