"use client";

import { useSession } from "next-auth/react";

export default function CloneRepoButton({ html_url, repo_name }: {html_url : string, repo_name: string}) {
	const { data: session } = useSession();

	const handleClone = async () => {
		const res = await fetch("/api/clone", {
			method: "POST",
			body: JSON.stringify({
				repoUrl: html_url,
				repoName: repo_name,
			}),
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${session?.accessToken}`,
			},
		});

		const data = await res.json();
		alert(data.message);
	};

	return (
		<button onClick={handleClone} className="bg-blue-600 text-white px-4 py-2 rounded">
			Clone Repo
		</button>
	);
}
