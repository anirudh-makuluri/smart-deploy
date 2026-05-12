import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	const token = userId ? await getGithubAccessTokenForUserId(userId, req.headers) : null;

	let body;
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { repo_url, package_path, commit_sha } = body as {
		repo_url: string;
		package_path: string;
		commit_sha: string;
	};

	if (!repo_url || !repo_url.trim()) {
		return NextResponse.json({ error: "Missing repo_url" }, { status: 400 });
	}
	if (!package_path || !package_path.trim()) {
		return NextResponse.json({ error: "Missing package_path" }, { status: 400 });
	}
	if (!commit_sha || !commit_sha.trim()) {
		return NextResponse.json({ error: "Missing commit_sha" }, { status: 400 });
	}

	const payload = {
		repo_url: repo_url.trim(),
		...(token ? { github_token: token } : {}),
		package_path: package_path.trim(),
		commit_sha: commit_sha.trim(),
	};

	try {
		console.log("Starting analyze stream for", payload.repo_url);
		const response = await fetch(`${process.env.SD_API_BASE_URL}/analyze/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${process.env.SD_API_BEARER_TOKEN}`,
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errText = await response.text();
			console.error(`Analyze stream failed: ${response.status} ${errText}`);
			const contentType = response.headers.get("content-type") || "application/json";
			return new Response(errText, {
				status: response.status,
				headers: {
					"Content-Type": contentType,
				},
			});
		}

		// Stream directly to the client
		return new Response(response.body, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Connection": "keep-alive"
			}
		});
	} catch (err: any) {
		console.error("Stream proxy error:", err);
		return NextResponse.json(
			{ error: "Stream API request failed", details: err?.message || "Unknown error" },
			{ status: 502 }
		);
	}
}
