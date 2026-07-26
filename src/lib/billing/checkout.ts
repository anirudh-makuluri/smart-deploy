import config from "@/config";
import { calculateTopupTax } from "@/lib/billing/tax";
import { getStripe } from "@/lib/stripe";
import type { TopupPackage } from "@/app/types";

export function getBillingBaseUrl(): string {
	return config.BETTER_AUTH_URL.replace(/\/$/, "");
}

export async function createTopupCheckoutSession(args: {
	userId: string;
	userEmail: string;
	stripeCustomerId: string | null;
	pkg: TopupPackage;
	countryCode: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
	const stripe = getStripe();
	const tax = calculateTopupTax({
		countryCode: args.countryCode,
		subtotalCents: args.pkg.priceCents,
	});
	const baseUrl = getBillingBaseUrl();
	const lineItems: Array<{
		price_data: {
			currency: string;
			product_data: { name: string; description: string };
			unit_amount: number;
		};
		quantity: number;
	}> = [
		{
			price_data: {
				currency: args.pkg.currency,
				product_data: {
					name: `${args.pkg.credits.toLocaleString()} SmartDeploy credits`,
					description: `Credit top-up package (${args.pkg.id})`,
				},
				unit_amount: tax.subtotalCents,
			},
			quantity: 1,
		},
	];

	if (tax.taxAmountCents > 0) {
		lineItems.push({
			price_data: {
				currency: args.pkg.currency,
				product_data: {
					name: "Estimated tax",
					description: `${(tax.taxRate * 100).toFixed(1)}% for ${tax.countryCode}`,
				},
				unit_amount: tax.taxAmountCents,
			},
			quantity: 1,
		});
	}

	const session = await stripe.checkout.sessions.create({
		mode: "payment",
		customer: args.stripeCustomerId ?? undefined,
		customer_email: args.stripeCustomerId ? undefined : args.userEmail,
		client_reference_id: args.userId,
		line_items: lineItems,
		success_url: `${baseUrl}/home?billing=success`,
		cancel_url: `${baseUrl}/home?billing=cancelled`,
		metadata: {
			user_id: args.userId,
			package_id: args.pkg.id,
			credits: String(args.pkg.credits),
			country_code: tax.countryCode,
			tax_amount_cents: String(tax.taxAmountCents),
			tax_rate: String(tax.taxRate),
			subtotal_cents: String(tax.subtotalCents),
		},
		payment_intent_data: {
			metadata: {
				user_id: args.userId,
				package_id: args.pkg.id,
				credits: String(args.pkg.credits),
				country_code: tax.countryCode,
				tax_amount_cents: String(tax.taxAmountCents),
				tax_rate: String(tax.taxRate),
			},
		},
	});

	if (!session.url) {
		throw new Error("Stripe did not return a checkout URL");
	}

	return {
		checkoutUrl: session.url,
		sessionId: session.id,
	};
}
