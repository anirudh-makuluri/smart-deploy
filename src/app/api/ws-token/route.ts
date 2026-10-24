import { NextResponse } from "next/server";
import { createWebSocketAuthToken } from "@/lib/wsAuth";
import { auth } from "@/lib/auth";
import { PlatformAccessError, requirePlatformAccess } from "@/lib/platformAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
	let userID: string | undefined;
	let sessionID: string | undefined;
	try {
		const session = await auth.api.getSession({ headers: req.headers, query: { disableCookieCache: true, disableRefresh: true } });
		if (session) await requirePlatformAccess(session.user);
		userID = session?.user?.id;
		sessionID = session?.session?.id;
	} catch (error) {
		if (error instanceof PlatformAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
		console.error("Websocket authorization unavailable.");
		return NextResponse.json({ error: "Websocket authorization unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
	}

	if (!userID || !sessionID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		const token = createWebSocketAuthToken(userID, sessionID);
		return NextResponse.json({ token }, { status: 200, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		console.error("Failed to create websocket auth token:", error);
		return NextResponse.json({ error: "Failed to create websocket token" }, { status: 500 });
	}
}
