import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { createWebSocketAuthToken } from "@/lib/wsAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const session = await getServerSession(authOptions);
	const userID = session?.userID;

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
