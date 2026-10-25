import { describe, expect, it, vi, beforeEach } from "vitest";

const listRunningDeploymentsForUptimeBillingMock = vi.fn();
const debitCreditsMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		listRunningDeploymentsForUptimeBilling: (...args: unknown[]) =>
			listRunningDeploymentsForUptimeBillingMock(...args),
		debitCredits: (...args: unknown[]) => debitCreditsMock(...args),
	},
}));

describe("uptimeBilling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("formats UTC hour buckets", async () => {
		const { formatUtcHourBucket, getBillableUtcHourBucket } = await import("@/lib/billing/uptimeBilling");
		const date = new Date("2026-07-25T16:42:00.000Z");
		expect(formatUtcHourBucket(date)).toBe("2026-07-25T16");
		expect(getBillableUtcHourBucket(new Date("2026-07-25T16:42:00.000Z"))).toBe("2026-07-25T15");
	});

	it("builds idempotent uptime reference ids", async () => {
		const { buildUptimeReferenceId } = await import("@/lib/billing/uptimeBilling");
		expect(buildUptimeReferenceId("dep-1", "2026-07-25T15")).toBe("uptime:dep-1:2026-07-25T15");
	});

	it("debits running deployments for the previous UTC hour", async () => {
		listRunningDeploymentsForUptimeBillingMock.mockResolvedValue({
			deployments: [
				{ id: "dep-1", userId: "user-1", repoName: "acme/app", serviceName: "web" },
			],
		});
		debitCreditsMock.mockResolvedValue({ debited: true, duplicate: false, insufficientBalance: false });

		const { reconcileUptimeBilling } = await import("@/lib/billing/uptimeBilling");
		const result = await reconcileUptimeBilling(new Date("2026-07-25T16:10:00.000Z"));

		expect(result.hourBucket).toBe("2026-07-25T15");
		expect(result.billed).toBe(1);
		expect(debitCreditsMock).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			credits: 4,
			referenceId: "uptime:dep-1:2026-07-25T15",
		}));
	});

	it("tracks insufficient balance without throwing", async () => {
		listRunningDeploymentsForUptimeBillingMock.mockResolvedValue({
			deployments: [
				{ id: "dep-1", userId: "user-1", repoName: "acme/app", serviceName: "web" },
			],
		});
		debitCreditsMock.mockResolvedValue({ debited: false, duplicate: false, insufficientBalance: true });

		const { reconcileUptimeBilling } = await import("@/lib/billing/uptimeBilling");
		const result = await reconcileUptimeBilling(new Date("2026-07-25T16:10:00.000Z"));

		expect(result.insufficient).toBe(1);
		expect(result.billed).toBe(0);
	});
});
