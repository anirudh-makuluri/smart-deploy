import type Stripe from "stripe";

import { dbHelper } from "@/db-helper";

function parseMetadataInt(value: string | null | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseMetadataFloat(value: string | null | undefined): number | null {
	if (!value) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export async function handleCheckoutSessionCompleted(
	session: Stripe.Checkout.Session
): Promise<{ granted: boolean; duplicate: boolean; error?: string }> {
	const metadata = session.metadata ?? {};
	const userId = (metadata.user_id ?? session.client_reference_id ?? "").trim();
	const credits = parseMetadataInt(metadata.credits);
	const referenceId = (session.payment_intent as string | null) ?? session.id;

	if (!userId || !credits || credits <= 0 || !referenceId) {
		return { granted: false, duplicate: false, error: "Missing checkout metadata for credit grant" };
	}

	const result = await dbHelper.grantCreditsFromTopup({
		userId,
		credits,
		referenceId,
		countryCode: metadata.country_code ? String(metadata.country_code) : null,
		taxAmountCents: parseMetadataInt(metadata.tax_amount_cents),
		taxRate: parseMetadataFloat(metadata.tax_rate),
		metadata: {
			package_id: metadata.package_id ?? null,
			checkout_session_id: session.id,
			subtotal_cents: parseMetadataInt(metadata.subtotal_cents),
			amount_total: session.amount_total,
			currency: session.currency,
		},
	});

	if (result.error) {
		return { granted: false, duplicate: result.duplicate, error: result.error };
	}

	const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
	if (stripeCustomerId) {
		await dbHelper.setUserStripeCustomerId({ userId, stripeCustomerId });
	}

	return { granted: result.granted, duplicate: result.duplicate };
}
