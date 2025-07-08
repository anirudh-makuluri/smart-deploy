"use client"

import * as React from "react"
import { z } from "zod"

import Header from "@/components/Header" // adjust based on your layout
import { use, useEffect, useState } from "react"
import Link from "next/link"
import { DeployConfig } from "@/app/types"
import { useSession } from "next-auth/react"
import { useDeployLogs } from "@/custom-hooks/useDeployLogs"
import { parseEnvVarsToStore } from "@/lib/utils"
import { useAppData } from "@/store/useAppData"
import { toast } from "sonner"
import ConfigTabs, { formSchema } from "@/components/ConfigTabs"


export default function Page({ params }: { params: Promise<{ id: string, username: string, reponame: string }> }) {
	const { id, username, reponame } = use(params)
	const { steps, sendDeployConfig, deployConfigRef, deployStatus } = useDeployLogs();
	const [isDeploying, setIsDeploying] = useState<boolean>(false);
	const { data: session } = useSession();
	const [dockerfile, setDockerfile] = useState<File | null>(null);
	const { repoList, updateDeploymentById } = useAppData();
	const repo = repoList.find(rep => rep.full_name == `${username}/${reponame}`);

	React.useEffect(() => {
		if (deployStatus == "success" && deployConfigRef.current) {
			setIsDeploying(false);
			addDeployment(deployConfigRef.current);
		}
	}, [deployStatus])

	if (!repo) {
		return (
			<div>Repo not found</div>
		)
	}

	function onSubmit(values: z.infer<typeof formSchema>) {
		if (!session?.accessToken) {
			return console.log("Unauthenticated")
		}

		if (values.env_vars) {
			values.env_vars = parseEnvVarsToStore(values.env_vars)
		}


		const payload: DeployConfig = {
			id,
			...values,
		};

		if (values.use_custom_dockerfile) {
			if (dockerfile) {
				payload.dockerfile = dockerfile;
			} else {
				toast("Dockerfile not provided")
				return;
			}
		}

		console.log("Form Data", payload);

		setIsDeploying(true);
		sendDeployConfig(payload, session?.accessToken);

	}

	async function addDeployment(deployment: DeployConfig) {
		deployment.first_deployment = new Date().toISOString();
		deployment.last_deployment = new Date().toISOString();
		deployment.revision = 1
		await updateDeploymentById(deployment)
	}

	return (
		<div className="bg-muted flex min-h-svh flex-col">
			<Header />
			<div className="max-w-2xl w-full mx-auto p-4">
				<ConfigTabs editMode={true} onSubmit={onSubmit} repo={repo}
					service_name={reponame} id={id} isDeploying={isDeploying} serviceLogs={[]} steps={steps} />
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
