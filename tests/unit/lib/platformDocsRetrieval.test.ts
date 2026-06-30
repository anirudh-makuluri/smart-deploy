import { beforeEach, describe, expect, it, vi } from "vitest";

const searchPlatformDocsMock = vi.fn();
const getMossPlatformDocsContextWithMetricsMock = vi.fn();

vi.mock("@/lib/platformDocsCore", () => ({
	searchPlatformDocs: searchPlatformDocsMock,
}));

vi.mock("@/lib/platformDocsMoss", () => ({
	getMossPlatformDocsContextWithMetrics: getMossPlatformDocsContextWithMetricsMock,
}));

describe("platformDocsRetrieval", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty results for blank queries", async () => {
		const { retrievePlatformDocChunks } = await import("@/lib/platformDocsRetrieval");

		const result = await retrievePlatformDocChunks("   ");

		expect(result).toEqual({
			chunks: [],
			mossEnabled: false,
			mossRetrievalMs: null,
		});
		expect(searchPlatformDocsMock).not.toHaveBeenCalled();
		expect(getMossPlatformDocsContextWithMetricsMock).not.toHaveBeenCalled();
	});

	it("merges deterministic and moss chunks with deduplication", async () => {
		searchPlatformDocsMock.mockResolvedValue([
			{
				id: "docs/FAQ.md#0",
				source: "docs/FAQ.md",
				section: "Runtime health",
				content: "Check ECS and ALB target health.",
				score: 2.1,
			},
		]);
		getMossPlatformDocsContextWithMetricsMock.mockResolvedValue({
			chunks: [
				{
					id: "docs/FAQ.md#0",
					source: "docs/FAQ.md",
					section: "Runtime health",
					content: "Check ECS and ALB target health.",
					score: 2.4,
				},
				{
					id: "docs/DEBUGGING_DEPLOYMENTS.md#1",
					source: "docs/DEBUGGING_DEPLOYMENTS.md",
					section: "502 errors",
					content: "Inspect ALB target group health first.",
					score: 3.2,
				},
			],
			mossRetrievalMs: 42,
			mossEnabled: true,
		});

		const { retrievePlatformDocChunks } = await import("@/lib/platformDocsRetrieval");
		const result = await retrievePlatformDocChunks("ALB unhealthy target 502", {
			deterministicLimit: 4,
			mossLimit: 4,
			mergedLimit: 4,
		});

		expect(searchPlatformDocsMock).toHaveBeenCalledWith("ALB unhealthy target 502", 4);
		expect(getMossPlatformDocsContextWithMetricsMock).toHaveBeenCalledWith("ALB unhealthy target 502", 4);
		expect(result.mossEnabled).toBe(true);
		expect(result.mossRetrievalMs).toBe(42);
		expect(result.chunks).toHaveLength(2);
		expect(result.chunks.map((chunk) => chunk.source)).toEqual([
			"docs/FAQ.md",
			"docs/DEBUGGING_DEPLOYMENTS.md",
		]);
	});
});