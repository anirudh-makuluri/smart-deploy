import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/authOptions";
import { getSupabaseServer } from "@/lib/supabaseServer";
import { dbHelper } from "@/db-helper";
import { captureDeploymentScreenshotAndUpload } from "@/lib/deploymentScreenshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GATEWAY_HTTP_STATUSES = new Set([502, 503, 504]);

function looksLikeGatewayErrorPage(bodyText: string): boolean {
	const normalized = bodyText.toLowerCase();
	return (
		normalized.includes("bad gateway") ||
		normalized.includes("gateway timeout") ||
		normalized.includes("service unavailable") ||
		normalized.includes("http error 502") ||
		normalized.includes("http error 503") ||
		normalized.includes("http error 504")
	);
}

async function isPreviewGatewayError(targetUrl: string): Promise<boolean> {
	try {
		const res = await fetch(targetUrl, {
			method: "GET",
			redirect: "follow",
			cache: "no-store",
			signal: AbortSignal.timeout(10000),
		});

		if (GATEWAY_HTTP_STATUSES.has(res.status)) return true;
		if (!res.ok) return false;

		const contentType = res.headers.get("content-type") || "";
		if (!contentType.toLowerCase().includes("text/html")) return false;

		const text = await res.text();
		return looksLikeGatewayErrorPage(text);
	} catch (err) {
		console.warn("preview health probe failed before screenshot capture:", err);
		return false;
	}
}

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
		const force = Boolean(body?.force);

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
		if (existingScreenshotUrl && !force) {
			return NextResponse.json({ status: "success", screenshotUrl: existingScreenshotUrl });
		}

		const deployUrl = String(data.deployUrl || "").trim();
		const customUrl = String(data.custom_url || "").trim();
		const targetUrl = customUrl || deployUrl;
		if (!targetUrl) {
			return NextResponse.json({ error: "No live URL available for this deployment" }, { status: 400 });
		}

		const gatewayErrorPreview = await isPreviewGatewayError(targetUrl);
		if (gatewayErrorPreview) {
			return NextResponse.json({
				status: "skipped",
				reason: "Preview URL is returning a gateway error page",
			});
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

