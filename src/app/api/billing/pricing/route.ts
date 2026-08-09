import { NextResponse } from "next/server";

import { getCreditPricingScenarios } from "@/lib/billing/creditPricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	return NextResponse.json(getCreditPricingScenarios());
}
