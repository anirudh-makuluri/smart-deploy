"use client"
import React, { useEffect, useState } from 'react'
import DashboardDeploymentItem from './DashboardDeploymentItem';
import { DeployConfig } from '@/app/types';
import { useAppData } from '@/store/useAppData';

export default function DashboardMain() {
	const { deployments, repoList } = useAppData();


	function getRepo(dep : DeployConfig) {
		for(let repo of repoList) {
			if(repo.html_url == dep.url) {
				return repo
			}
		}
	}

	return (
		<div className="h-full w-2/3">
			<p className='font-bold text-xl my-2'>Services</p>
			<div className='rounded-2xl pl-4 py-2 w-[80%] h-full grid grid-cols-2'>
				{
					deployments.length == 0 ?
					<div>No Services Found</div>
					:
					deployments.filter(dep => dep.status != 'didnt_deploy').map((dep, i) => 
						<DashboardDeploymentItem 
							deployConfig={dep} 
							key={i}
							repo={getRepo(dep)}
						/>)
				}
			</div>
		</div>
	)
}
