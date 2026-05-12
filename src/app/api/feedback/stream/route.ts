import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;

	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: {
		repo_url?: string;
		commit_sha?: string;
		package_path?: string;
		feedback?: string;
		failure_summary?: string;
		failure_logs?: string;
		failed_artifact_scope?: string;
	};
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { repo_url, commit_sha, package_path, feedback, failure_summary, failure_logs, failed_artifact_scope } = body;

	if (!repo_url) {
		return NextResponse.json({ error: "Missing repo_url" }, { status: 400 });
	}
	if (!commit_sha) {
		return NextResponse.json({ error: "Missing commit_sha" }, { status: 400 });
	}
	if (!feedback) {
		return NextResponse.json({ error: "Missing feedback" }, { status: 400 });
	}

	try {
		const response = await fetch(`${process.env.SD_API_BASE_URL}/feedback/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${process.env.SD_API_BEARER_TOKEN}`,
			},
			body: JSON.stringify({
				repo_url,
				commit_sha,
				...(package_path && { package_path }),
				feedback,
				...(failure_summary && { failure_summary }),
				...(failure_logs && { failure_logs }),
				...(failed_artifact_scope && { failed_artifact_scope }),
			}),
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Feedback stream failed: ${response.status} ${errText}`);
			const contentType = response.headers.get("content-type") || "application/json";
			return new Response(errText, {
				status: response.status,
				headers: {
					"Content-Type": contentType,
				},
			});
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
