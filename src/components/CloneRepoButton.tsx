"use client";

import { cloneRepo } from "@/lib/graphqlClient";

export default function CloneRepoButton({ html_url, repo_name }: {html_url : string, repo_name: string}) {
	const handleClone = async () => {
		const message = await cloneRepo(html_url, repo_name);
		alert(message);
	};

	return (
		<button onClick={handleClone} className="bg-blue-600 text-white px-4 py-2 rounded">
			Clone Repo
		</button>
	);
}
