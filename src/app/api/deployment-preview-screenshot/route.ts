import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { getSupabaseServer } from "@/lib/supabaseServer";
import { dbHelper } from "@/db-helper";
import { captureDeploymentScreenshotAndUpload } from "@/lib/deploymentScreenshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const userID = session?.userID as string | undefined;
		if (!userID) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		const repoName = String(body?.repoName || "").trim();
		const serviceName = String(body?.serviceName || "").trim();

		if (!repoName || !serviceName) {
			return NextResponse.json({ error: "repoName and serviceName are required" }, { status: 400 });
		}

		const supabase = getSupabaseServer();
		const { data: row, error: fetchError } = await supabase
			.from("deployments")
			.select("id, data, status")
			.eq("owner_id", userID)
			.eq("repo_name", repoName)
			.eq("service_name", serviceName)
			.order("last_deployment", { ascending: false })
			.limit(1)
			.maybeSingle();

		if (fetchError) {
			return NextResponse.json({ error: fetchError.message }, { status: 500 });
		}
		if (!row) {
			return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
		}

		const data = (row.data || {}) as Record<string, unknown>;
		const existingScreenshotUrl = String(data.screenshot_url || "").trim();
		if (existingScreenshotUrl) {
			return NextResponse.json({ status: "success", screenshotUrl: existingScreenshotUrl });
		}

		const deployUrl = String(data.deployUrl || "").trim();
		const customUrl = String(data.custom_url || "").trim();
		const targetUrl = customUrl || deployUrl;
		if (!targetUrl) {
			return NextResponse.json({ error: "No live URL available for this deployment" }, { status: 400 });
		}

		const screenshotPublicUrl = await captureDeploymentScreenshotAndUpload({
			url: targetUrl,
			ownerID: userID,
			repoName,
			serviceName,
		});

		const patch = await dbHelper.patchDeploymentData(repoName, serviceName, userID, {
			screenshot_url: screenshotPublicUrl,
		});
		if ("error" in patch && patch.error) {
			return NextResponse.json({ error: patch.error }, { status: 500 });
		}

		return NextResponse.json({ status: "success", screenshotUrl: screenshotPublicUrl });
	} catch (err: unknown) {
		console.error("deployment-preview-screenshot error:", err);
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json({ error: message }, { status: 500 });
	}
}

