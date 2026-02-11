import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { addVercelDnsRecord } from "@/lib/vercelDns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		if (!session?.accessToken) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		const deployUrl = typeof body.deployUrl === "string" ? body.deployUrl.trim() : "";
		const serviceName = typeof body.service_name === "string" ? body.service_name : "app";
		const deploymentTarget = typeof body.deploymentTarget === "string" ? body.deploymentTarget : null;
		const previousCustomUrl = typeof body.previousCustomUrl === "string" ? body.previousCustomUrl : null;
		if (!deployUrl) {
			return NextResponse.json({ error: "deployUrl is required" }, { status: 400 });
		}
		const result = await addVercelDnsRecord(deployUrl, serviceName, {
			deploymentTarget,
			previousCustomUrl,
		});

		if (result.success) {
			return NextResponse.json({ success: true, customUrl: result.customUrl });
		}
		return NextResponse.json({ error: result.error }, { status: 400 });
	} catch (error) {
		console.error("Vercel add-dns-record error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to add DNS record" },
			{ status: 500 }
		);
	}
}
