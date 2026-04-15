import { NextResponse } from "next/server";
import { createWebSocketAuthToken } from "@/lib/wsAuth";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
	let userID: string | undefined;
	try {
		const session = await auth.api.getSession({ headers: req.headers });
		userID = session?.user?.id;
	} catch (error) {
		console.error("Failed to read session for websocket token:", error);
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const token = createWebSocketAuthToken(userID);
		return NextResponse.json({ token }, { status: 200 });
	} catch (error) {
		console.error("Failed to create websocket auth token:", error);
		return NextResponse.json({ error: "Failed to create websocket token" }, { status: 500 });
	}
}
