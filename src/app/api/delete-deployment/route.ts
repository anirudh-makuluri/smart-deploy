import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { deleteDeploymentForOwner } from "../../../lib/deleteDeploymentHelper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID;

		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const { repoName, serviceName } = await req.json();
		const validRepoName = typeof repoName === "string" ? repoName.trim() : "";
		const validServiceName = typeof serviceName === "string" ? serviceName.trim() : "";

		if (!validRepoName || !validServiceName) {
			return NextResponse.json(
				{ error: "Missing or invalid repoName or serviceName. Both must be non-empty strings." },
				{ status: 400 }
			);
		}

		const result = await deleteDeploymentForOwner({
			repoName: validRepoName,
			serviceName: validServiceName,
			userID,
		});

		return NextResponse.json(result.body, { status: result.status });
	} catch (err: unknown) {
		console.error("delete-deployment error:", err);
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
