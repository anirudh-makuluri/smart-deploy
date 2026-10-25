import Stripe from "stripe";

import config from "@/config";

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
	return Boolean(config.STRIPE_SECRET_KEY.trim());
}

export function getStripe(): Stripe {
	if (!isStripeConfigured()) {
		throw new Error("Stripe is not configured");
	}
	if (!stripeClient) {
		stripeClient = new Stripe(config.STRIPE_SECRET_KEY);
	}
	return stripeClient;
}
