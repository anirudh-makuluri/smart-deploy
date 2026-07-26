import { NextResponse } from "next/server";

import { dbHelper } from "@/db-helper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const { packages, error } = await dbHelper.getTopupPackages();
	if (error) {
		return NextResponse.json({ error }, { status: 503 });
	}
	return NextResponse.json({ packages });
}
