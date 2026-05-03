import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function DELETE(req: Request) {
	const session = await auth.api.getSession({ headers: req.headers });
	const userId = session?.user?.id;

	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body;
	try {
		body = await req.json();
	} catch (e) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const { response_id } = body as { response_id?: string };

	if (!response_id || !response_id.trim()) {
		return NextResponse.json({ error: "Missing response_id" }, { status: 400 });
	}

	try {
		console.log("Deleting cache for response_id", response_id);
		const response = await fetch(`${process.env.SD_API_BASE_URL}/cache`, {
			method: "DELETE",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${process.env.SD_API_BEARER_TOKEN}`,
			},
			body: JSON.stringify({ response_id })
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
