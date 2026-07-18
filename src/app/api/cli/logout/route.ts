import { NextResponse } from "next/server";
import { getCliBearerToken, revokeCliAccessToken } from "@/lib/cliAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const token = getCliBearerToken(request.headers);
	if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	await revokeCliAccessToken(token);
	return new NextResponse(null, { status: 204 });
}
