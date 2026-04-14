import { NextRequest, NextResponse } from "next/server";
import { executeGraphQLOperation } from "@/app/api/graphql/route";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseLimit(raw: string | null): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(n) || n <= 0) return 50;
	return Math.min(n, 5000);
}

// GET ?repoName=xxx&serviceName=yyy&limit=200
// Returns the most recent `limit` logs in chronological order (oldest -> newest).
export async function GET(req: NextRequest) {
	const start = Date.now();
	try {
		const session = await auth.api.getSession({ headers: req.headers });
		const userID = session?.user?.id;
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const repoName = (req.nextUrl.searchParams.get("repoName") ?? "").trim();
		const serviceName = (req.nextUrl.searchParams.get("serviceName") ?? "").trim();
		const limit = parseLimit(req.nextUrl.searchParams.get("limit"));

		if (!serviceName) {
			return NextResponse.json({ error: "serviceName is required" }, { status: 400 });
		}

		const response = await executeGraphQLOperation(
			"serviceLogs",
			{ repoName, serviceName, limit },
			({ userID } as { userID?: string }) ?? null
		) as { serviceLogs?: { logs?: unknown[] } };

		const logs = response.serviceLogs?.logs ?? [];
		return NextResponse.json({ logs });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return NextResponse.json({ error: message }, { status: 500 });
	} finally {
		console.debug(`[GraphQL-compat] service-logs-history completed in ${Date.now() - start}ms`);
	}
}

