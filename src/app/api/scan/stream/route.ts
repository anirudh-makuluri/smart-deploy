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

	let body;
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { full_name, branch, target_workdir } = body;

	if (!full_name) {
		return NextResponse.json({ error: "Missing full_name" }, { status: 400 });
	}

	const payload = {
		repo_url: `https://github.com/${full_name}`,
		github_token: token,
		...(branch && { branch }),
		...(target_workdir && { target_workdir })
	};

	try {
		console.log("Starting analyze stream for", payload.repo_url);
		const response = await fetch("http://localhost:8080/analyze/stream", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
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
