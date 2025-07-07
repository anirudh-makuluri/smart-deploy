"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form"

import Header from "@/components/Header" // adjust based on your layout
import { use, useEffect, useState } from "react"
import Link from "next/link"
import { DeployConfig } from "@/app/types"
import { useSession } from "next-auth/react"
import { useDeployLogs } from "@/custom-hooks/useDeployLogs"
import DeploymentAccordion from "@/components/DeploymentAccordion"
import { parseEnvVarsToStore } from "@/lib/utils"

export const formSchema = z.object({
	url: z.string().url({ message: "Must be a valid URL" }),
	service_name: z.string(),
	branch: z.string().min(1, { message: "Branch is required" }),
	build_cmd: z.string().min(1, { message: "Build command is required" }),
	run_cmd: z.string().min(1, { message: "Run command is required" }),
	env_vars: z.string().optional(),
	workdir: z.string().optional(),
	use_custom_dockerfile: z.boolean()
})


export default function Page({ params }: { params: Promise<{ id: string, username: string, reponame: string }> }) {
	const { id, username, reponame } = use(params)
	const { steps, sendDeployConfig, deployConfigRef } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();


	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			url: `https://github.com/${username}/${reponame}`,
			service_name: `${reponame}-service`,
			branch: "main",
			build_cmd: "npm run build",
			run_cmd: "npm start",
			env_vars: "",
			workdir: "",
			use_custom_dockerfile: false,
		},
	})


	function onSubmit(values: z.infer<typeof formSchema>) {
		if (!session?.accessToken) {
			return console.log("Unauthorized")
		}

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}
		console.log("Form Data", values)
		// submit to backend here

		setIsDeploying(true);	
		sendDeployConfig({ id ,...values }, session?.accessToken)

	}

	return (
		<div className="bg-muted flex min-h-svh flex-col">
			<Header />
			<div className="max-w-2xl w-full mx-auto mt-10 p-4">
				<p className="text-xl font-semibold mb-6">Configure Deployment</p>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						<FormField
							control={form.control}
							name="url"
							render={({ field }) => (
								<FormItem>
									<FormLabel>GitHub Repository URL</FormLabel>
									<FormControl>
										<Input disabled {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="service_name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Service Name</FormLabel>
									<FormControl>
										<Input disabled {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="branch"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Branch to Deploy</FormLabel>
									<FormControl>
										<Input placeholder="e.g. main" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="build_cmd"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Build Command</FormLabel>
									<FormControl>
										<Input placeholder="e.g. npm run build" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="run_cmd"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Run Command</FormLabel>
									<FormControl>
										<Input placeholder="e.g. npm start" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="env_vars"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Environment Variables</FormLabel>
									<FormControl>
										<Textarea
											placeholder="KEY=value (one per line)"
											className="min-h-[100px]"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="workdir"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Working Directory</FormLabel>
									<FormControl>
										<Input placeholder="e.g. /app or ./client" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="use_custom_dockerfile"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center space-x-3 space-y-0">
									<FormControl>
										<input
											type="checkbox"
											className="mt-1 h-4 w-4"
											checked={field.value}
											onChange={e => field.onChange(e.target.checked)}
										/>
									</FormControl>
									<div className="space-y-1 leading-none">
										<FormLabel>Use custom Dockerfile</FormLabel>
									</div>
								</FormItem>
							)}
						/>

						<Button disabled={isDeploying} type="submit" className="w-full">
							{isDeploying ? "Deploying..." : "Deploy"}
						</Button>
					</form>
				</Form>
				{
					isDeploying ?
						(
							<div className="bg-card mt-2 p-2">
								<p>Logs:</p>
								<DeploymentAccordion steps={steps} />
							</div>
						) : null
				}
				{
					deployConfigRef.current?.deployUrl ? 
						<div>Deployment Successful: 
							<Link className="underline text-blue-600" href={deployConfigRef.current?.deployUrl}> Link</Link>
						</div> : null
				}
			</div>
		</div>
	)
}
