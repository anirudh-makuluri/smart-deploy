import { NextRequest, NextResponse } from "next/server";
import { addRoute53DnsRecord } from "@/lib/route53Dns";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
	try {
		const session = await auth.api.getSession({ headers: req.headers });
		if (!session?.user?.id) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		const deployUrl = typeof body.deployUrl === "string" ? body.deployUrl.trim() : "";
		const serviceName = typeof body.serviceName === "string" ? body.serviceName : "app";
		const deploymentTarget = typeof body.deploymentTarget === "string" ? body.deploymentTarget : null;
		const previousCustomUrl = typeof body.previousCustomUrl === "string" ? body.previousCustomUrl : null;
		const sharedAlbDns = typeof body.sharedAlbDns === "string" ? body.sharedAlbDns.trim() : null;
		const awsRegion = typeof body.awsRegion === "string" ? body.awsRegion.trim() : null;
		if (!deployUrl && !sharedAlbDns) {
			return NextResponse.json({ error: "deployUrl or sharedAlbDns is required" }, { status: 400 });
		}
		const result = await addRoute53DnsRecord(deployUrl || `https://${sharedAlbDns}`, serviceName, {
			deploymentTarget,
			previousCustomUrl,
			sharedAlbDns,
			awsRegion,
		});

		if (result.success) {
			return NextResponse.json({ success: true, customUrl: result.customUrl });
		}
		return NextResponse.json({ error: result.error }, { status: 400 });
	} catch (error) {
		console.error("Route 53 add-dns-record error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to add DNS record" },
			{ status: 500 }
		);
	}
}
