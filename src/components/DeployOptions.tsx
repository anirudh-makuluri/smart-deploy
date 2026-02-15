"use client"

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, GitBranch, Rocket } from "lucide-react";
import { useState } from "react";
import { repoType } from "@/app/types";

interface DeployOptionsProps {
	onDeploy: (commitSha?: string) => void;
	disabled?: boolean;
	repo: repoType | undefined;
	branch: string;
}

export default function DeployOptions({ onDeploy, disabled, repo, branch }: DeployOptionsProps) {
	const [isFetchingCommit, setIsFetchingCommit] = useState(false);

	const handleDeployLatestCommit = async () => {
		if (!repo || !repo.owner?.login) return;

		setIsFetchingCommit(true);
		try {
			const response = await fetch("/api/commits/latest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					owner: repo.owner.login,
					repo: repo.name,
					branch: branch,
				}),
			});

			if (!response.ok) {
				throw new Error("Failed to fetch latest commit");
			}

			const data = await response.json();
			onDeploy(data.commit.sha);
		} catch (error) {
			console.error("Error fetching latest commit:", error);
			// Fallback to deploying without commit SHA
			onDeploy();
		} finally {
			setIsFetchingCommit(false);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					disabled={disabled || isFetchingCommit}
					className="landing-build-blue hover:opacity-45 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
				>
					<Rocket className="h-4 w-4" />
					{isFetchingCommit ? "Fetching..." : "Deploy"}
					<ChevronDown className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card border-border text-foreground min-w-50">
				<DropdownMenuItem
					onClick={() => onDeploy()}
					className="cursor-pointer hover:bg-secondary text-white focus:bg-secondary"
				>
					<GitBranch className="h-4 w-4 mr-2" />
					Deploy from Branch ({branch})
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={handleDeployLatestCommit}
					disabled={isFetchingCommit || !repo}
					className="cursor-pointer hover:bg-secondary text-white focus:bg-secondary disabled:opacity-50"
				>
					<Rocket className="h-4 w-4 mr-2" />
					{isFetchingCommit ? "Fetching..." : "Deploy Latest Commit"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

