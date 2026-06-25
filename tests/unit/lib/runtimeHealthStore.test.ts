import { describe, expect, it } from "vitest";
import type { RuntimeHealthSample } from "@/app/types";
import { __testing } from "@/lib/runtimeHealthStore";

function sample(checkedAt: string): RuntimeHealthSample {
	return {
		checkedAt,
		app: {
			checkedUrl: "https://example.com/health",
			httpStatus: 200,
			latencyMs: 120,
			probeResults: [true, true, true],
			overallStatus: "healthy",
		},
		ecs: null,
		alb: null,
	};
}

describe("runtimeHealthStore trimming", () => {
	it("keeps only the most recent entries up to the configured max", () => {
		const entries = Array.from({ length: 12 }, (_, index) =>
			sample(`2026-06-25T00:${String(index).padStart(2, "0")}:00.000Z`)
		);

		const trimmed = __testing.trimRecentHealthSamples(entries, 10);

		expect(trimmed).toHaveLength(10);
		expect(trimmed[0]?.checkedAt).toBe("2026-06-25T00:02:00.000Z");
		expect(trimmed[9]?.checkedAt).toBe("2026-06-25T00:11:00.000Z");
	});
});
