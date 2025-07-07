"use client"
import { useSession } from 'next-auth/react'
import React, { useEffect, useState } from 'react'
import { Button } from './ui/button';
import Link from 'next/link'
import { repoType } from '@/app/types';
import { useAppData } from '@/store/useAppData';


export default function DashboardSideBar() {
	const { data: session } = useSession();
	const { repoList } = useAppData();

	return (
		<div className="h-full w-1/3 px-4 py-2">
			<p className='font-bold text-2xl my-2'>{session?.user?.name}</p>
			<Button className='bg-accent-foreground my-2 hover:cursor-pointer'>Import</Button>
			<div className='rounded-2xl pl-4 py-2 w-[80%]'>
				<p className='font-bold text-xl my-2'>Repositories</p>
				<ul className="mt-4 space-y-2 max-h-[65vh] overflow-y-auto">
					{repoList.map((repo: repoType) => (
						<li key={repo.id} className="bg-card p-2 rounded-md w-[80%]">
							<Link className='w-full' href={`/repo/${repo.id}/${repo.full_name}`}>
								{repo.full_name.split("/")[1]}
							</Link>
						</li>
					))}
				</ul>
			</div>
		</div>
	)
}
