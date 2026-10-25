import { NextResponse } from "next/server";

import { reconcileUptimeBilling } from "@/lib/billing/uptimeBilling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const token = process.env.BILLING_CRON_TOKEN?.trim() || "";
	if (token) {
		const auth = request.headers.get("authorization")?.trim() || "";
		if (auth !== `Bearer ${token}`) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}
	}

	const result = await reconcileUptimeBilling();
	return NextResponse.json({ ok: true, ...result });
}
