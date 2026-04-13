import { beforeEach, describe, expect, it, vi } from "vitest";

const getGlobalDeployMetricsForPublicMock = vi.fn();

vi.mock("@/lib/metrics/deployMetrics", () => ({
	getGlobalDeployMetricsForPublic: () => getGlobalDeployMetricsForPublicMock(),
}));

describe("GET /api/metrics/public", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns enabled false payload when global metrics are disabled", async () => {
		getGlobalDeployMetricsForPublicMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/metrics/public/route");
		const res = await GET();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ enabled: false });
	});

	it("returns metrics when enabled", async () => {
		getGlobalDeployMetricsForPublicMock.mockResolvedValue({
			totalCount: 3,
			successCount: 2,
			successRatePercent: 67,
			durationSampleCount: 3,
			medianDurationMs: 100,
			p95DurationMs: 500,
			computedAt: "2026-01-01T00:00:00.000Z",
		});
		const { GET } = await import("@/app/api/metrics/public/route");
		const res = await GET();
		const body = await res.json();
		expect(body.enabled).toBe(true);
		expect(body.totalCount).toBe(3);
	});
});
