import { beforeEach, describe, expect, it, vi } from "vitest";

const claimStripeWebhookEventMock = vi.fn();
const grantCreditsFromTopupMock = vi.fn();
const setUserStripeCustomerIdMock = vi.fn();
const constructEventMock = vi.fn();
const isStripeConfiguredMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		claimStripeWebhookEvent: (...args: unknown[]) => claimStripeWebhookEventMock(...args),
		grantCreditsFromTopup: (...args: unknown[]) => grantCreditsFromTopupMock(...args),
		setUserStripeCustomerId: (...args: unknown[]) => setUserStripeCustomerIdMock(...args),
	},
}));

vi.mock("@/lib/stripe", () => ({
	isStripeConfigured: (...args: unknown[]) => isStripeConfiguredMock(...args),
	getStripe: () => ({
		webhooks: {
			constructEvent: (...args: unknown[]) => constructEventMock(...args),
		},
	}),
}));

vi.mock("@/config", () => ({
	default: {
		STRIPE_WEBHOOK_SECRET: "whsec_test",
	},
}));

const paidSessionEvent = {
	id: "evt_1",
	type: "checkout.session.completed",
	data: {
		object: {
			id: "cs_test",
			payment_status: "paid",
			payment_intent: "pi_test",
			client_reference_id: "user-1",
			customer: "cus_test",
			amount_total: 1190,
			currency: "usd",
			metadata: {
				user_id: "user-1",
				package_id: "starter",
				credits: "500",
				country_code: "DE",
				tax_amount_cents: "190",
				tax_rate: "0.19",
				subtotal_cents: "1000",
			},
		},
	},
};

describe("POST /api/billing/webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isStripeConfiguredMock.mockReturnValue(true);
		constructEventMock.mockReturnValue(paidSessionEvent);
		claimStripeWebhookEventMock.mockResolvedValue({ claimed: true });
		grantCreditsFromTopupMock.mockResolvedValue({ granted: true, duplicate: false });
		setUserStripeCustomerIdMock.mockResolvedValue({});
	});

	it("grants credits for a paid checkout session", async () => {
		const { POST } = await import("@/app/api/billing/webhook/route");
		const response = await POST(new Request("http://localhost/api/billing/webhook", {
			method: "POST",
			headers: { "stripe-signature": "sig_test" },
			body: JSON.stringify(paidSessionEvent),
		}));

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true, granted: true, duplicate: false });
		expect(claimStripeWebhookEventMock).toHaveBeenCalledWith({
			eventId: "evt_1",
			eventType: "checkout.session.completed",
		});
		expect(grantCreditsFromTopupMock).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			credits: 500,
			referenceId: "pi_test",
		}));
		expect(setUserStripeCustomerIdMock).toHaveBeenCalledWith({
			userId: "user-1",
			stripeCustomerId: "cus_test",
		});
	});

	it("rejects invalid signatures before touching the database", async () => {
		constructEventMock.mockImplementation(() => {
			throw new Error("Invalid signature");
		});
		const { POST } = await import("@/app/api/billing/webhook/route");
		const response = await POST(new Request("http://localhost/api/billing/webhook", {
			method: "POST",
			headers: { "stripe-signature": "bad" },
			body: "{}",
		}));

		expect(response.status).toBe(400);
		expect(claimStripeWebhookEventMock).not.toHaveBeenCalled();
	});

	it("accepts duplicate Stripe events without re-granting credits", async () => {
		claimStripeWebhookEventMock.mockResolvedValue({ claimed: false });
		const { POST } = await import("@/app/api/billing/webhook/route");
		const response = await POST(new Request("http://localhost/api/billing/webhook", {
			method: "POST",
			headers: { "stripe-signature": "sig_test" },
			body: JSON.stringify(paidSessionEvent),
		}));

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true, duplicate: true });
		expect(grantCreditsFromTopupMock).not.toHaveBeenCalled();
	});
});
