import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { dbHelper } from "@/db-helper";
import { auth } from "@/lib/auth";
import { isSdArtifactsAnalyzeScan } from "@/lib/scanResultNormalization";
import type { ScanResultsPayload } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
	repoName?: string;
	serviceName?: string;
	url?: string;
	branch?: string;
	commitSha?: string | null;
	responseId?: string | null;
	scanResults?: ScanResultsPayload;
};

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userID = session?.user?.id;
	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: Body;
	try {
		body = (await req.json()) as Body;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const repoName = String(body.repoName ?? "").trim();
	const serviceName = String(body.serviceName ?? "").trim();
	if (!repoName || !serviceName) {
		return NextResponse.json({ error: "Missing repoName or serviceName" }, { status: 400 });
	}

	const scanResults = body.scanResults;
	if (!scanResults || typeof scanResults !== "object" || Array.isArray(scanResults)) {
		return NextResponse.json({ error: "Missing scanResults" }, { status: 400 });
	}

	const responseIdFromBody = typeof body.responseId === "string" ? body.responseId.trim() : "";
	const responseIdFromScan = isSdArtifactsAnalyzeScan(scanResults) ? scanResults.response_id?.trim() : "";
	const responseId = responseIdFromBody || responseIdFromScan || null;

	const result = await dbHelper.updateDeployments(
		{
			repoName,
			serviceName,
			url: body.url ?? "",
			branch: body.branch ?? "main",
			commitSha: body.commitSha ?? null,
			responseId,
			scanResults,
		} as never,
		userID
	);

	if (result.error) {
		const message = typeof result.error === "string" ? result.error : "Failed to save analysis";
		return NextResponse.json({ error: message }, { status: 500 });
	}

	return NextResponse.json({
		ok: true,
		responseId: result.responseId ?? responseId,
	});
}
