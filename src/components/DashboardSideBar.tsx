"use client"
import { useSession } from 'next-auth/react'
import React, { useEffect, useState } from 'react'
import { Button } from './ui/button';
import Link from 'next/link'
import { repoType } from '@/app/types';
import { useAppData } from '@/store/useAppData';
import { RefreshCcw } from 'lucide-react'
import { toast } from 'sonner';
import { formatTimestamp } from '@/lib/utils';


export default function DashboardSideBar() {

	const { data: session } = useSession();
	const { repoList , refreshRepoList} = useAppData();

	const [isRefreshing, setIsRefreshing] = useState(false);

	async function handleRefresh() {
		setIsRefreshing(true);
		const response = await refreshRepoList();
		setIsRefreshing(false);
		toast(response.message);	
	}

	return (
		<div className="h-full w-1/3 px-4 py-2">
			<p className='font-bold text-2xl my-2'>{session?.user?.name}</p>
			<div className='rounded-2xl pl-4 py-2 w-[80%]'>
				<div className='flex flex-row items-center justify-between'>
					<p className='font-bold text-xl my-2'>Repositories</p>
					<Button onClick={handleRefresh} variant={'outline'} disabled={isRefreshing} className='my-2 hover:cursor-pointer'>
						<RefreshCcw className={isRefreshing ? 'spin-animation' : ''}/>Refresh
					</Button>
				</div>
				<ul className="mt-4 space-y-2 max-h-[65vh] overflow-y-auto">
					{repoList.map((repo: repoType) => (
						<li key={repo.id} className="bg-card p-2 rounded-md w-[80%]">
							<Link className='w-full' href={`/repo/${repo.id}/${repo.full_name}`}>
								<p>{repo.full_name.split("/")[1]}</p>
								<p className='text-[10px] opacity-50 truncate mt-0.5'><strong>Latest Commit:</strong> {repo.latest_commit?.message}</p>
								<p className='text-[10px] opacity-50 truncate mt-0.5'><strong>On:</strong> {formatTimestamp(repo.latest_commit?.date)} 
								</p>
							</Link>
						</li>
					))}
				</ul>
			</div>
		</div>
	)
}
