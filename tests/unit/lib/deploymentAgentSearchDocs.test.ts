import { beforeEach, describe, expect, it, vi } from "vitest";

const retrievePlatformDocChunksMock = vi.fn();

vi.mock("@/lib/platformDocsRetrieval", () => ({
	retrievePlatformDocChunks: retrievePlatformDocChunksMock,
}));

describe("deploymentAgent search_docs tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns trimmed doc chunks and citations", async () => {
		retrievePlatformDocChunksMock.mockResolvedValue({
			chunks: [
				{
					id: "docs/FAQ.md#0",
					source: "docs/FAQ.md",
					section: "Runtime health",
					content: "A".repeat(1500),
					score: 2.4,
				},
				{
					id: "docs/DEBUGGING_DEPLOYMENTS.md#1",
					source: "docs/DEBUGGING_DEPLOYMENTS.md",
					section: "502 errors",
					content: "Inspect ALB target group health first.",
					score: 3.1,
				},
			],
			mossEnabled: true,
			mossRetrievalMs: 55,
		});

		const { searchDocsTool } = await import("@/lib/deploymentAgent/tools/searchDocs");
		const result = await searchDocsTool.execute(
			{ userID: "user-1" },
			{ query: "ALB unhealthy target 502" }
		);

		expect(retrievePlatformDocChunksMock).toHaveBeenCalledWith("ALB unhealthy target 502", 4);
		expect(result).toMatchObject({
			query: "ALB unhealthy target 502",
			mossEnabled: true,
			mossRetrievalMs: 55,
			citations: ["docs/FAQ.md", "docs/DEBUGGING_DEPLOYMENTS.md"],
		});
		expect(result.chunks[0]?.content.endsWith("...")).toBe(true);
		expect(result.chunks[0]?.content.length).toBeLessThanOrEqual(1203);
		expect(result.chunks[1]?.relevance).toBe(3.1);
	});

	it("rejects empty query arguments", async () => {
		const { searchDocsTool } = await import("@/lib/deploymentAgent/tools/searchDocs");

		await expect(searchDocsTool.execute({ userID: "user-1" }, { query: "   " })).rejects.toThrow(
			/query/i
		);
	});
});