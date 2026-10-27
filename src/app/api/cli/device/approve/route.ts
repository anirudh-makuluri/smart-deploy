import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveDeviceAuthorization } from "@/lib/cliAuth";
import { PlatformAccessError, requirePlatformAccess } from "@/lib/platformAccess";
import { isJsonObject } from "@/lib/httpResponse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	try {
		const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
		if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		await requirePlatformAccess(session.user);

		let body: unknown;
		try { body = await request.json(); }
		catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
		if (!isJsonObject(body) || typeof body.code !== "string" || !body.code.trim() || body.code.length > 200) {
			return NextResponse.json({ error: "A valid approval code is required." }, { status: 400 });
		}
		const code = body.code;
		const status = await approveDeviceAuthorization(code, session.user.id);
		if (status !== "approved") return NextResponse.json({ error: "Authorization request is no longer pending" }, { status: 409 });
		return NextResponse.json({ ok: true });
	} catch (error) {
		if (error instanceof PlatformAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
		return NextResponse.json({ error: "CLI authorization unavailable." }, { status: 503 });
	}
}
