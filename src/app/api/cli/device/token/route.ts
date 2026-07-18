import { NextResponse } from "next/server";
import { consumeDeviceAuthorization } from "@/lib/cliAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	let body: { deviceCode?: unknown };
	try {
		body = await request.json() as { deviceCode?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode : "";
	if (!deviceCode.trim()) return NextResponse.json({ error: "deviceCode is required" }, { status: 400 });
	const result = await consumeDeviceAuthorization(deviceCode);
	if (!result) return NextResponse.json({ status: "pending" }, { status: 202 });
	return NextResponse.json({ accessToken: result.token, tokenType: "Bearer" });
}
