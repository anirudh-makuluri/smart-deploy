import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getTopupPackageByIdMock = vi.fn();
const getUserBillingAccountMock = vi.fn();
const setUserStripeCustomerIdMock = vi.fn();
const createTopupCheckoutSessionMock = vi.fn();
const customersCreateMock = vi.fn();
const isStripeConfiguredMock = vi.fn();

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getTopupPackageById: (...args: unknown[]) => getTopupPackageByIdMock(...args),
		getUserBillingAccount: (...args: unknown[]) => getUserBillingAccountMock(...args),
		setUserStripeCustomerId: (...args: unknown[]) => setUserStripeCustomerIdMock(...args),
	},
}));

vi.mock("@/lib/billing/checkout", () => ({
	createTopupCheckoutSession: (...args: unknown[]) => createTopupCheckoutSessionMock(...args),
}));

vi.mock("@/lib/stripe", () => ({
	isStripeConfigured: (...args: unknown[]) => isStripeConfiguredMock(...args),
	getStripe: () => ({
		customers: {
			create: (...args: unknown[]) => customersCreateMock(...args),
		},
	}),
}));

describe("POST /api/billing/checkout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		isStripeConfiguredMock.mockReturnValue(true);
		getSessionMock.mockResolvedValue({
			user: { id: "user-1", email: "user@example.com" },
		});
		getTopupPackageByIdMock.mockResolvedValue({
			pkg: {
				id: "starter",
				credits: 500,
				priceCents: 500,
				currency: "usd",
				active: true,
				sortOrder: 1,
			},
		});
		getUserBillingAccountMock.mockResolvedValue({
			stripeCustomerId: null,
			creditBalance: 0,
		});
		customersCreateMock.mockResolvedValue({ id: "cus_new" });
		setUserStripeCustomerIdMock.mockResolvedValue({});
		createTopupCheckoutSessionMock.mockResolvedValue({
			checkoutUrl: "https://checkout.stripe.test/session",
			sessionId: "cs_test",
		});
	});

	it("creates a checkout session for an authenticated user", async () => {
		const { POST } = await import("@/app/api/billing/checkout/route");
		const response = await POST(new Request("http://localhost/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ packageId: "starter", countryCode: "US" }),
		}));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			checkoutUrl: "https://checkout.stripe.test/session",
			sessionId: "cs_test",
		});
		expect(customersCreateMock).toHaveBeenCalled();
		expect(createTopupCheckoutSessionMock).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			stripeCustomerId: "cus_new",
			countryCode: "US",
		}));
	});

	it("rejects unauthenticated requests", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/billing/checkout/route");
		const response = await POST(new Request("http://localhost/api/billing/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ packageId: "starter", countryCode: "US" }),
		}));

		expect(response.status).toBe(401);
	});
});
