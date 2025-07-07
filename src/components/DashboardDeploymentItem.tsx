import { DeployConfig, repoType } from '@/app/types'
import React from 'react'
import { EllipsisVertical, Pause, Play } from 'lucide-react'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatTimestamp } from '@/lib/utils';
import Link from 'next/link';

export default function DashboardDeploymentItem({ deployConfig, repo }: { deployConfig: DeployConfig, repo: repoType | undefined }) {

	function changeStatus(action: string) {
		const serviceName = deployConfig.service_name;
		fetch("/api/deployment-control", {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				serviceName, action
			}),
		})
	}

	return (
		<div className='bg-card px-4 py-2 rounded-md flex flex-col justify-between items-center'>
			<div className='flex flex-row items-center justify-between'>
				<div>
					<Link href={`/services/${deployConfig.service_name}`}><p className='font-bold mb-2 hover:underline'>{deployConfig.service_name}</p></Link>
					<a href={deployConfig.deployUrl} target='_blank'><p className='text-xs mb-4 hover:underline'>{deployConfig.deployUrl}</p></a>
				</div>
				<div className='flex flex-row space-x-2 items-center'>
					<div className={(deployConfig.status == 'running' ? 'bg-green-500' : 'bg-red-500') + ' w-3.5 h-3.5 rounded-full'}>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger className='hover:bg-muted hover:cursor-pointer p-2 rounded-xl'>
							<EllipsisVertical />
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem onClick={() => changeStatus(deployConfig.status == 'running' ? "pause" : "resume")}>
								{deployConfig.status == 'running' ? "Pause" : "Play"}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => changeStatus("stop")}>Delete</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<div>
				<a href={deployConfig.url} target='_blank'>
					<p className='bg-muted opacity-80 hover:opacity-100 rounded-2xl px-2 py-1 text-sm w-fit font-semibold flex flex-row'>
						{repo?.full_name}
					</p>
				</a>
				<div className='flex flex-col space-y-3 mt-6'>
					<p className='text-sm'>{repo?.latest_commit?.message}</p>
					<p>{formatTimestamp(repo?.latest_commit?.date)} on <strong>{repo?.default_branch}</strong></p>
				</div>
			</div>
		</div>
	)
}
