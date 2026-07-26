import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { dbHelper } from "@/db-helper";
import { auth } from "@/lib/auth";
import { createTopupCheckoutSession } from "@/lib/billing/checkout";
import { normalizeCountryCode } from "@/lib/billing/tax";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckoutBody = {
	packageId: string;
	countryCode: string;
};

function parseCheckoutBody(value: unknown): CheckoutBody | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.packageId !== "string" || typeof record.countryCode !== "string") return null;
	return {
		packageId: record.packageId.trim(),
		countryCode: record.countryCode.trim(),
	};
}

export async function POST(request: Request) {
	if (!isStripeConfigured()) {
		return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
	}

	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	const userEmail = session?.user?.email;
	if (!userId || !userEmail) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const parsed = parseCheckoutBody(body);
	if (!parsed || !parsed.packageId || !parsed.countryCode) {
		return NextResponse.json({ error: "packageId and countryCode are required" }, { status: 400 });
	}

	const countryCode = normalizeCountryCode(parsed.countryCode);
	if (!/^[A-Z]{2}$/.test(countryCode)) {
		return NextResponse.json({ error: "countryCode must be a 2-letter ISO code" }, { status: 400 });
	}

	const pkgResult = await dbHelper.getTopupPackageById(parsed.packageId);
	if (pkgResult.error) {
		return NextResponse.json({ error: pkgResult.error }, { status: 503 });
	}
	if (!pkgResult.pkg) {
		return NextResponse.json({ error: "Package not found" }, { status: 404 });
	}

	const account = await dbHelper.getUserBillingAccount(userId);
	if (account.error) {
		return NextResponse.json({ error: account.error }, { status: 503 });
	}

	let stripeCustomerId = account.stripeCustomerId;
	if (!stripeCustomerId) {
		const stripe = getStripe();
		const customer = await stripe.customers.create({
			email: userEmail,
			metadata: { user_id: userId },
		});
		stripeCustomerId = customer.id;
		const saved = await dbHelper.setUserStripeCustomerId({ userId, stripeCustomerId });
		if (saved.error) {
			return NextResponse.json({ error: saved.error }, { status: 503 });
		}
	}

	try {
		const checkout = await createTopupCheckoutSession({
			userId,
			userEmail,
			stripeCustomerId,
			pkg: pkgResult.pkg,
			countryCode,
		});
		return NextResponse.json({
			checkoutUrl: checkout.checkoutUrl,
			sessionId: checkout.sessionId,
		});
	} catch (error) {
		console.error("createTopupCheckoutSession error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Could not create checkout session" },
			{ status: 502 }
		);
	}
}
