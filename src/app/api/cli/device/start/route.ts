import { NextResponse } from "next/server";
import { startDeviceAuthorization } from "@/lib/cliAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	try {
		const authorization = await startDeviceAuthorization();
		const origin = new URL(request.url).origin;
		return NextResponse.json({
			deviceCode: authorization.deviceCode,
			verificationUri: origin + "/cli/authorize?code=" + encodeURIComponent(authorization.approvalCode),
			expiresIn: Math.floor((authorization.expiresAt.getTime() - Date.now()) / 1000),
			interval: 3,
		});
	} catch (error) {
		console.error("Failed to start CLI device authorization:", error);
		return NextResponse.json({ error: "Failed to start CLI authorization" }, { status: 500 });
	}
}
