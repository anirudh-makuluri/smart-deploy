"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";

export default function DeployButton({ repoUrl }: { repoUrl: string }) {
	const { data: session } = useSession();
	const [status, setStatus] = useState("");

	const deploy = async () => {
		setStatus("Deploying...");

		const res = await fetch("/api/deploy", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${session?.accessToken}`,
			},
			body: JSON.stringify({
				repoUrl
			}),
		});

		const data = await res.json();
		setStatus(data.url ? `✅ Deployed at ${data.url}` : `❌ Error: ${data.error}`);
	};

	return (
		<div>
			<button onClick={deploy} className="px-4 py-2 bg-blue-600 text-white rounded">
				Deploy to Cloud Run
			</button>
			<p className="mt-2">{status}</p>
		</div>
	);
}
