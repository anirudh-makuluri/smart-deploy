import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/authOptions";
import { getSdApiBaseUrl, getSdApiHeaders } from "../../../lib/sdApi";

export async function DELETE(req: Request) {
	const session = await getServerSession(authOptions);
	const token = session?.accessToken;

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	let body;
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { repo_url, commit_sha } = body;

	if (!repo_url) {
		return NextResponse.json({ error: "Missing repo_url" }, { status: 400 });
	}

	try {
		console.log("Deleting cache for", repo_url, commit_sha || "(all)");
		const response = await fetch(`${getSdApiBaseUrl()}/cache`, {
			method: "DELETE",
			headers: getSdApiHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ repo_url, commit_sha })
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Cache deletion failed: ${response.status} ${errText}`);
			throw new Error(`Cache deletion failed: ${response.status} ${errText}`);
		}

		const result = await response.json();
		return NextResponse.json(result);
	} catch (err: any) {
		console.error("Cache deletion proxy error:", err);
		return NextResponse.json(
			{ error: "Cache deletion request failed", details: err?.message || "Unknown error" },
			{ status: 502 }
		);
	}
}
