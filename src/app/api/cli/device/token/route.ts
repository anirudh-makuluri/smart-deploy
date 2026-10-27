import { NextResponse } from "next/server";
import { consumeDeviceAuthorization } from "@/lib/cliAuth";
import { PlatformAccessError } from "@/lib/platformAccess";
import { isJsonObject } from "@/lib/httpResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const deviceCode = isJsonObject(body) && typeof body.deviceCode === "string" && body.deviceCode.length <= 200 ? body.deviceCode : "";
	if (!deviceCode.trim()) return NextResponse.json({ error: "deviceCode is required" }, { status: 400 });
	try {
		const result = await consumeDeviceAuthorization(deviceCode);
		if (!result) return NextResponse.json({ status: "pending" }, { status: 202, headers: { "Cache-Control": "no-store" } });
		return NextResponse.json({ accessToken: result.token, tokenType: "Bearer" }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof PlatformAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
		return NextResponse.json({ error: "CLI authorization unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
	}
}
