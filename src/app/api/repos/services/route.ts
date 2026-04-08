import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { executeGraphQLOperation } from "@/app/api/graphql/route";
import { authOptions } from "@/app/api/auth/authOptions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const start = Date.now();
	try {
		const session = await getServerSession(authOptions);
		const userID = (session as { userID?: string })?.userID;
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const response = await executeGraphQLOperation("repoServices", {}, session as any);
		const services = (response?.repoServices as any) ?? [];
		return NextResponse.json({ services });
	} catch (err) {
		console.error("GET /api/repos/services error:", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Failed to load services" },
			{ status: 500 }
		);
	} finally {
		console.debug(`[GraphQL-compat] repos/services completed in ${Date.now() - start}ms`);
	}
}
