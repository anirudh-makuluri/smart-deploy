import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { dbHelper } from "@/db-helper";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	if (!userId) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const account = await dbHelper.getUserBillingAccount(userId);
	if (account.error) {
		return NextResponse.json({ error: account.error }, { status: 503 });
	}

	const ledger = await dbHelper.getCreditLedgerEntries({ userId, limit: 20 });
	if (ledger.error) {
		return NextResponse.json({ error: ledger.error }, { status: 503 });
	}

	return NextResponse.json({
		balance: account.creditBalance,
		stripeCustomerId: account.stripeCustomerId,
		ledger: ledger.entries,
	});
}
