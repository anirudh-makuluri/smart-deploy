import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	const token = userId ? await getGithubAccessTokenForUserId(userId) : null;

	if (!token) {
		return NextResponse.json({ error: "GitHub not connected" }, { status: 401 });
	}

	let body;
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { full_name, package_path } = body;

	if (!full_name) {
		return NextResponse.json({ error: "Missing full_name" }, { status: 400 });
	}

	const payload = {
		repo_url: `https://github.com/${full_name}`,
		github_token: token,
		...(package_path && { package_path }),
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
			throw new Error(`Analyze stream failed: ${response.status} ${errText}`);
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
