import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { dbHelper } from "@/db-helper";
import { authOptions } from "@/app/api/auth/authOptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	try {
		const session = await getServerSession(authOptions);
		const userID = (session as { userID?: string })?.userID;
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const result = await dbHelper.getUserRepoServices(userID);
		if (result.error) {
			return NextResponse.json({ error: result.error }, { status: 500 });
		}
		return NextResponse.json({ services: result.records ?? [] });
	} catch (err) {
		console.error("GET /api/repos/services error:", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Failed to load services" },
			{ status: 500 }
		);
	}
}
