"use client"
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTimestamp, parseEnvVarsToDisplay, parseEnvVarsToStore } from "@/lib/utils";
import { useAppData } from "@/store/useAppData";
import { Separator } from "@radix-ui/react-dropdown-menu";
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

import { formSchema } from "@/app/repo/[id]/[username]/[reponame]/page";
import { Switch } from "@/components/ui/switch";
import { isEqual } from 'lodash'
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table"
import { useDeployLogs } from "@/custom-hooks/useDeployLogs";
import { useSession } from "next-auth/react";
import DeploymentAccordion from "@/components/DeploymentAccordion";
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation'
import { DeployConfig } from "@/app/types";

export default function Page({ service_name }: { service_name: string }) {
	const { deployments, updateDeploymentById } = useAppData();
	const router = useRouter();
	const searchParams = useSearchParams();
	const new_change = searchParams.get('new-change')

	const { steps, sendDeployConfig, deployStatus, deployConfigRef } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();

	const [editMode, setEditMode] = useState(false);
	const [newChanges, setNewChanges] = useState(new_change ?? false);

	const deployment = deployments.find((dep) => dep.service_name == service_name);

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			url: deployment?.url,
			service_name: deployment?.service_name,
			branch: deployment?.branch,
			build_cmd: deployment?.build_cmd,
			run_cmd: deployment?.run_cmd,
			env_vars: deployment?.env_vars,
			workdir: deployment?.workdir,
			use_custom_dockerfile: deployment?.use_custom_dockerfile,
		},
	})

	React.useEffect(() => {
		if (deployStatus == "success" && deployConfigRef.current) {
			setIsDeploying(false);
			updateDeployment(deployConfigRef.current);
		}
	}, [deployStatus])

	if (!deployment) return (
		<div>Service Not Found</div>
	)

	async function onSubmit(values: z.infer<typeof formSchema>) {
		setEditMode(false)

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}

		if (deployment?.id) {
			const newDeployment = { ...deployment, ...values }
			updateDeployment(newDeployment);
		} else {
			console.log("Could not update")
		}

	}

	async function updateDeployment(newDeployment: DeployConfig) {
		if (!deployment || isEqual(deployment, newDeployment)) return;


		newDeployment.last_deployment = new Date().toISOString();
		newDeployment.revision = newDeployment.revision ? newDeployment.revision + 1 : 2
		await updateDeploymentById(newDeployment)
		setNewChanges(true)
		if (newDeployment.service_name != deployment.service_name) {
			router.replace(`/services/${newDeployment.service_name}?new-change=true`)
		}
	}

	function handleRedeploy() {
		if (!session?.accessToken) {
			return console.log("Unauthorized")
		}

		if (!deployment) return;


		setIsDeploying(true);
		setNewChanges(false);

		if (deployment.env_vars) {
			deployment.env_vars = parseEnvVarsToStore(deployment.env_vars)
		}

		sendDeployConfig(deployment, session?.accessToken)
	}

	return (
		<>
			<Header />
			<div className="flex flex-row">
				<div id="Sidebar" className="w-1/4 h-full py-4 px-4">
					<p className="font-bold text-3xl mb-8">Service Overview</p>
					<p className="font-semibold text-xl mb-1">{deployment.service_name}</p>
					<p className="font-light text-xs text-slate-400 mb-4">{deployment.status}</p>
					<p className="text-sm text-slate-300 mb-4">Live URL:
						<a target="_blank" href={deployment.deployUrl} className="hover:underline"> {deployment.deployUrl}</a>
					</p>
					<p className="text-sm text-slate-300 mb-4">Last Deployed : {formatTimestamp(deployment.last_deployment)}</p>
					<p className="text-sm text-slate-300 mb-4">Revision : {deployment.revision ?? 1}</p>
					<p className="text-xl font-bold mb-6">Actions</p>
					<div className="flex flex-col space-y-4">
						<Button onClick={handleRedeploy} variant={newChanges ? "default" : "outline"}>
							{isDeploying ? "Redeploying" : deployStatus == "success" ? "Deployment Success!" : "Redeploy"}
						</Button>
						<Button variant={'outline'}>Pause</Button>
						<Button variant={'outline'}>Stop/Delete</Button>
						{
							!editMode && (
								<Button onClick={() => { setEditMode(true) }} variant={'default'}>Edit Config</Button>
							)
						}
					</div>
				</div>
				<div id="main" className="w-3/4 h-full py-4 px-24">
					<Form {...form}>
						<form onSubmit={form.handleSubmit(onSubmit)} className="w-3/4 h-full py-4 px-20">
							<p className="font-bold text-xl whitespace-nowrap my-4">Environment & Configuration</p>
							<Separator className="bg-slate-700 h-[1px]" />

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
									<span className="text-slate-400 w-40">{deployment.service_name}</span>
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
									<span className="text-slate-400 w-40">{deployment.build_cmd}</span>
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
									<span className="text-slate-400 w-40">{deployment.run_cmd}</span>
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
													<Input {...field} />
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-slate-400 w-40">{deployment.branch}</span>
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
									<span className="text-slate-400 w-40">{deployment.workdir || '-'}</span>
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
														checked={field.value}
														onCheckedChange={field.onChange}
													/>
												</FormControl>
											</FormItem>
										)}
									/>
								) : (
									<span className="text-slate-400 w-40">
										{deployment.use_custom_dockerfile ? 'Yes' : 'No'}
									</span>
								)}
							</div>

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
										{deployment.env_vars ? (
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


							{/* Submit button in edit mode */}
							{editMode && (
								<Button type="submit" className="mt-6">
									Save Changes
								</Button>
							)}
						</form>
					</Form>

					<Button className="absolute bottom-10 right-10" variant={'outline'}>Copy Config</Button>
					{
						isDeploying ?
							(
								<div className="bg-card mt-2 p-2">
									<p>Logs:</p>
									<DeploymentAccordion steps={steps} />
								</div>
							) : null
					}
				</div>

			</div>

		</>
	)
}