import { NextResponse } from "next/server";
import type Stripe from "stripe";

import config from "@/config";
import { dbHelper } from "@/db-helper";
import { handleCheckoutSessionCompleted } from "@/lib/billing/webhookHandlers";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
	if (!isStripeConfigured() || !config.STRIPE_WEBHOOK_SECRET.trim()) {
		console.error("Stripe webhook received without STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.");
		return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
	}

	const payload = await request.text();
	const signature = request.headers.get("stripe-signature");
	if (!signature) {
		return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
	}

	let event: Stripe.Event;
	try {
		event = getStripe().webhooks.constructEvent(payload, signature, config.STRIPE_WEBHOOK_SECRET);
	} catch (error) {
		console.error("Stripe webhook signature verification failed:", error);
		return NextResponse.json({ error: "Invalid Stripe webhook signature" }, { status: 400 });
	}

	const claimed = await dbHelper.claimStripeWebhookEvent({
		eventId: event.id,
		eventType: event.type,
	});
	if (claimed.error) {
		console.error("Could not persist Stripe webhook event:", claimed.error);
		return NextResponse.json({ error: "Could not process Stripe webhook" }, { status: 503 });
	}
	if (!claimed.claimed) {
		return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 });
	}

	try {
		if (event.type === "checkout.session.completed") {
			const session = event.data.object as Stripe.Checkout.Session;
			if (session.payment_status !== "paid") {
				return NextResponse.json({ accepted: true, skipped: true }, { status: 202 });
			}
			const result = await handleCheckoutSessionCompleted(session);
			if (result.error) {
				console.error("Stripe checkout.session.completed grant failed:", result.error);
				return NextResponse.json({ error: result.error }, { status: 500 });
			}
			return NextResponse.json({
				accepted: true,
				granted: result.granted,
				duplicate: result.duplicate,
			}, { status: 202 });
		}

		if (event.type === "payment_intent.payment_failed") {
			const paymentIntent = event.data.object as Stripe.PaymentIntent;
			console.warn("Stripe payment failed:", paymentIntent.id, paymentIntent.last_payment_error?.message);
			return NextResponse.json({ accepted: true }, { status: 202 });
		}

		return new NextResponse(null, { status: 204 });
	} catch (error) {
		console.error("Stripe webhook handler failed:", error);
		return NextResponse.json({ error: "Stripe webhook handler failed" }, { status: 500 });
	}
}
