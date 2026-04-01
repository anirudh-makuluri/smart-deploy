import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/authOptions";
import { getSdApiBaseUrl, getSdApiHeaders } from "../../../lib/sdApi";

export async function POST(req: Request) {
	const session = await getServerSession(authOptions);
	const token = session?.accessToken;

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	let body: { repo_url?: string; commit_sha?: string; feedback?: string };
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { repo_url, commit_sha, feedback } = body;

	if (!repo_url) {
		return NextResponse.json({ error: "Missing repo_url" }, { status: 400 });
	}
	if (!feedback) {
		return NextResponse.json({ error: "Missing feedback" }, { status: 400 });
	}

	try {
		const response = await fetch(`${getSdApiBaseUrl()}/feedback`, {
			method: "POST",
			headers: getSdApiHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				repo_url,
				...(commit_sha && { commit_sha }),
				feedback,
			}),
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Feedback request failed: ${response.status} ${errText}`);
			throw new Error(`Feedback request failed: ${response.status} ${errText}`);
		}

		const result = await response.json();
		return NextResponse.json(result);
	} catch (err: unknown) {
		console.error("Feedback proxy error:", err);
		return NextResponse.json(
			{
				error: "Feedback request failed",
				details: err instanceof Error ? err.message : "Unknown error",
			},
			{ status: 502 }
		);
	}
}
