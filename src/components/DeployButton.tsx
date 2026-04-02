"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeployButton({ repoUrl }: { repoUrl: string }) {
	const router = useRouter();
	const [status, setStatus] = useState("");

	function parseRepoUrl(input: string): { owner: string; repo: string } | null {
		const normalized = input.trim().replace(/\.git$/i, "");
		const match = normalized.match(/github\.com[/]([^/]+)[/]([^/]+)/i);
		if (!match) return null;
		return { owner: match[1], repo: match[2] };
	}

	const deploy = () => {
		const parsed = parseRepoUrl(repoUrl);
		if (!parsed) {
			setStatus("Could not parse GitHub repository URL.");
			return;
		}

		setStatus("Opening deployment workspace...");
		router.push(`/${parsed.owner}/${parsed.repo}`);
	};

	return (
		<div>
			<button onClick={deploy} className="px-4 py-2 bg-blue-600 text-white rounded">
				Open Deploy Workspace
			</button>
			<p className="mt-2">{status}</p>
		</div>
	);
}
