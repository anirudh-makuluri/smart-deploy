import { describe, expect, it } from "vitest";
import { aggregateRowsToSummary, mapRpcToSummary, percentileLinear } from "@/lib/metrics/deployMetricsCore";

describe("percentileLinear", () => {
	it("returns null for empty input", () => {
		expect(percentileLinear([], 0.5)).toBeNull();
	});

	it("matches continuous interpolation for two points", () => {
		expect(percentileLinear([10, 20], 0.5)).toBe(15);
	});
});

describe("mapRpcToSummary", () => {
	it("maps RPC payload and rounds rates", () => {
		const s = mapRpcToSummary(
			{
				total_count: 10,
				success_count: 9,
				duration_sample_count: 8,
				median_duration_ms: 1500.2,
				p95_duration_ms: 9000.7,
			},
			"2026-01-01T00:00:00.000Z"
		);
		expect(s.totalCount).toBe(10);
		expect(s.successCount).toBe(9);
		expect(s.successRatePercent).toBe(90);
		expect(s.medianDurationMs).toBe(1500);
		expect(s.p95DurationMs).toBe(9001);
		expect(s.computedAt).toBe("2026-01-01T00:00:00.000Z");
	});
});

describe("aggregateRowsToSummary", () => {
	it("aggregates rows without RPC", () => {
		const rows = [
			{ success: true, duration_ms: 1000 },
			{ success: false, duration_ms: 2000 },
			{ success: true, duration_ms: null },
		];
		const s = aggregateRowsToSummary(rows, "t0");
		expect(s.totalCount).toBe(3);
		expect(s.successCount).toBe(2);
		expect(s.successRatePercent).toBe(67);
		expect(s.durationSampleCount).toBe(2);
		expect(s.medianDurationMs).toBe(1500);
	});
});
