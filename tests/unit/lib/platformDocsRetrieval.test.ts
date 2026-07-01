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

	it("returns moss chunks when moss has results", async () => {
		searchPlatformDocsMock.mockResolvedValue([
			{
				id: "docs/DEBUGGING_DEPLOYMENTS.md#0",
				source: "docs/DEBUGGING_DEPLOYMENTS.md",
				section: "1. Ask the Deployment Agent",
				content: "Ask why a deployment failed.",
				score: 3.2,
			},
		]);
		getMossPlatformDocsContextWithMetricsMock.mockResolvedValue({
			chunks: [
				{
					id: "docs/RAILPACK.md#0",
					source: "docs/RAILPACK.md",
					section: "Railpack",
					content: "Railpack is the default build system for most apps.",
					score: 0.95,
				},
				{
					id: "docs/RAILPACK.md#1",
					source: "docs/RAILPACK.md",
					section: "How deploy uses the plan",
					content: "CodeBuild decodes the Railpack plan JSON from the scan.",
					score: 0.91,
				},
			],
			mossRetrievalMs: 42,
			mossEnabled: true,
		});

		const { retrievePlatformDocChunks } = await import("@/lib/platformDocsRetrieval");
		const result = await retrievePlatformDocChunks("how Railpack is used in deployment", 4);

		expect(getMossPlatformDocsContextWithMetricsMock).toHaveBeenCalledWith("how Railpack is used in deployment", 4);
		expect(searchPlatformDocsMock).not.toHaveBeenCalled();
		expect(result.mossEnabled).toBe(true);
		expect(result.mossRetrievalMs).toBe(42);
		expect(result.chunks).toHaveLength(2);
		expect(result.chunks.map((chunk) => chunk.source)).toEqual(["docs/RAILPACK.md", "docs/RAILPACK.md"]);
	});

	it("falls back to deterministic search when moss returns no chunks", async () => {
		searchPlatformDocsMock.mockResolvedValue([
			{
				id: "docs/FAQ.md#0",
				source: "docs/FAQ.md",
				section: "Runtime health",
				content: "Check ECS and ALB target health.",
				score: 2.1,
			},
			{
				id: "docs/DEBUGGING_DEPLOYMENTS.md#1",
				source: "docs/DEBUGGING_DEPLOYMENTS.md",
				section: "502 errors",
				content: "Inspect ALB target group health first.",
				score: 3.2,
			},
		]);
		getMossPlatformDocsContextWithMetricsMock.mockResolvedValue({
			chunks: [],
			mossRetrievalMs: 12,
			mossEnabled: false,
		});

		const { retrievePlatformDocChunks } = await import("@/lib/platformDocsRetrieval");
		const result = await retrievePlatformDocChunks("ALB unhealthy target 502", 4);

		expect(getMossPlatformDocsContextWithMetricsMock).toHaveBeenCalledWith("ALB unhealthy target 502", 4);
		expect(searchPlatformDocsMock).toHaveBeenCalledWith("ALB unhealthy target 502", 4);
		expect(result.mossEnabled).toBe(false);
		expect(result.mossRetrievalMs).toBe(12);
		expect(result.chunks).toHaveLength(2);
		expect(result.chunks.map((chunk) => chunk.source)).toEqual([
			"docs/FAQ.md",
			"docs/DEBUGGING_DEPLOYMENTS.md",
		]);
	});
});