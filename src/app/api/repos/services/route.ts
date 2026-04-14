import { NextResponse } from "next/server";
import { executeGraphQLOperation } from "@/app/api/graphql/route";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req?: Request) {
	const start = Date.now();
	try {
		const session = await auth.api.getSession({ headers: req?.headers ?? new Headers() });
		const userID = session?.user?.id;
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const response = await executeGraphQLOperation(
			"repoServices",
			{},
			session ? ({ userID } as { userID?: string }) : null
		) as { repoServices?: unknown[] };
		const services = response.repoServices ?? [];
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
