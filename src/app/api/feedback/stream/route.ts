import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/authOptions";

export const dynamic = "force-dynamic";

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
		const response = await fetch("http://localhost:8080/feedback/stream", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				repo_url,
				...(commit_sha && { commit_sha }),
				feedback,
			}),
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Feedback stream failed: ${response.status} ${errText}`);
			throw new Error(`Feedback stream failed: ${response.status} ${errText}`);
		}

		return new Response(response.body, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive",
			},
		});
	} catch (err: unknown) {
		console.error("Feedback stream proxy error:", err);
		return NextResponse.json(
			{
				error: "Feedback stream request failed",
				details: err instanceof Error ? err.message : "Unknown error",
			},
			{ status: 502 }
		);
	}
}
