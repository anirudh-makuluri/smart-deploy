import { NextResponse } from "next/server";
import appConfig from "@/config";
import { dbHelper } from "@/db-helper";
import { auth } from "@/lib/auth";
import { approveDeviceAuthorization } from "@/lib/cliAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	if (appConfig.WAITING_LIST_ENABLED) {
		const email = session.user.email ?? "";
		const { approved } = await dbHelper.isApprovedUser(email);
		if (!approved) {
			return NextResponse.json(
				{ error: "Your account is not approved for CLI access yet." },
				{ status: 403 }
			);
		}
	}

	let body: { code?: unknown };
	try {
		body = await request.json() as { code?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}
	const code = typeof body.code === "string" ? body.code : "";
	try {
		const status = await approveDeviceAuthorization(code, session.user.id);
		if (status !== "approved") return NextResponse.json({ error: "Authorization request is no longer pending" }, { status: 409 });
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed" }, { status: 400 });
	}
}
