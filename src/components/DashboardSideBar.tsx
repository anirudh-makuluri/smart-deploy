"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import { Button } from "./ui/button";
import Link from "next/link";
import { repoType } from "@/app/types";
import { useAppData } from "@/store/useAppData";
import { RefreshCcw, FolderGit2 } from "lucide-react";
import { toast } from "sonner";
import { formatTimestamp } from "@/lib/utils";

export default function DashboardSideBar() {
	const { data: session } = useSession();
	const { repoList, refreshRepoList } = useAppData();
	const [isRefreshing, setIsRefreshing] = useState(false);

	async function handleRefresh() {
		setIsRefreshing(true);
		const response = await refreshRepoList();
		setIsRefreshing(false);
		toast(response.message);
	}

	return (
		<aside className="flex-shrink-0 w-80 lg:w-96 flex flex-col min-h-0 border-r border-[#1e3a5f]/60 bg-[#132f4c]/40">
			<div className="flex-shrink-0 p-4 border-b border-[#1e3a5f]/60">
				<p className="text-[#94a3b8] text-xs uppercase tracking-wider font-medium">Signed in as</p>
				<p className="text-[#e2e8f0] font-semibold truncate mt-0.5">{session?.user?.name ?? session?.user?.email}</p>
			</div>
			<div className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden">
				<div className="flex-shrink-0 flex items-center justify-between gap-2 mb-4">
					<div className="flex items-center gap-2">
						<FolderGit2 className="size-5 text-[#14b8a6]" />
						<h2 className="font-semibold text-[#e2e8f0]">Repositories</h2>
					</div>
					<Button
						onClick={handleRefresh}
						variant="outline"
						size="sm"
						disabled={isRefreshing}
						className="border-[#1e3a5f] bg-transparent text-[#e2e8f0] hover:bg-[#1e3a5f]/50 hover:text-[#e2e8f0] shrink-0"
					>
						<RefreshCcw className={`size-4 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
						Refresh
					</Button>
				</div>
				<ul className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
					{repoList.length === 0 ? (
						<li className="text-[#94a3b8] text-sm py-4 px-3 rounded-lg border border-dashed border-[#1e3a5f]/60">
							No repositories yet. Connect a repo from a service to see it here.
						</li>
					) : (
						repoList.map((repo: repoType) => (
							<li key={repo.id}>
								<Link
									href={`/repo/${repo.id}/${repo.full_name}`}
									className="block rounded-lg border border-[#1e3a5f]/60 bg-[#0c1929]/60 hover:bg-[#1e3a5f]/30 hover:border-[#1e3a5f] p-3 transition-colors"
								>
									<p className="font-medium text-[#e2e8f0] truncate">{repo.full_name.split("/")[1]}</p>
									<p className="text-xs text-[#94a3b8] truncate mt-1">{repo.full_name}</p>
									{repo.latest_commit && (
										<p className="text-xs text-[#64748b] mt-2 truncate" title={repo.latest_commit.message}>
											{repo.latest_commit.message}
										</p>
									)}
									{repo.latest_commit?.date && (
										<p className="text-xs text-[#64748b] mt-0.5">{formatTimestamp(repo.latest_commit.date)}</p>
									)}
								</Link>
							</li>
						))
					)}
				</ul>
			</div>
		</aside>
	);
}
