import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { webScrapeMdMock, webSearchMock } = vi.hoisted(() => ({
	webScrapeMdMock: vi.fn(),
	webSearchMock: vi.fn(),
}));

vi.mock("context.dev", () => ({
	default: class ContextDevMock {
		web = {
			search: webSearchMock,
			webScrapeMd: webScrapeMdMock,
		};
	},
}));

describe("deploymentAgent search_external_docs tool", () => {
	const originalApiKey = process.env.CONTEXT_DEV_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.CONTEXT_DEV_API_KEY;
	});

	afterEach(() => {
		if (originalApiKey === undefined) {
			delete process.env.CONTEXT_DEV_API_KEY;
			return;
		}
		process.env.CONTEXT_DEV_API_KEY = originalApiKey;
	});

	it("returns an unavailable result without an API key", async () => {
		const { searchExternalDocsTool } = await import("@/lib/deploymentAgent/tools/searchExternalDocs");

		const result = await searchExternalDocsTool.execute(
			{ userID: "user-1" },
			{ query: "ECS deployment circuit breaker" }
		);

		expect(result).toMatchObject({
			contextDevEnabled: false,
			results: [],
			error: expect.stringContaining("CONTEXT_DEV_API_KEY"),
		});
		expect(webSearchMock).not.toHaveBeenCalled();
	});

	it("searches an official docs domain and returns trimmed Markdown", async () => {
		process.env.CONTEXT_DEV_API_KEY = "ctxt_secret_test";
		webSearchMock.mockResolvedValue({
			results: [
				{
					title: "Amazon ECS deployment circuit breaker",
					url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html",
					description: "Roll back failed ECS deployments.",
				},
			],
		});
		webScrapeMdMock.mockResolvedValue({ markdown: "A".repeat(1300) });

		const { searchExternalDocsTool } = await import("@/lib/deploymentAgent/tools/searchExternalDocs");
		const result = await searchExternalDocsTool.execute(
			{ userID: "user-1" },
			{
				query: "ECS deployment circuit breaker",
				sourceDomain: "docs.aws.amazon.com",
			}
		);

		expect(webSearchMock).toHaveBeenCalledWith({
			query: "site:docs.aws.amazon.com ECS deployment circuit breaker",
			numResults: 10,
			tags: ["smart-deploy", "deployment-agent"],
		});
		expect(webScrapeMdMock).toHaveBeenCalledWith({
			url: "https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html",
			includeLinks: true,
			maxAgeMs: 86_400_000,
			tags: ["smart-deploy", "deployment-agent"],
			useMainContentOnly: true,
		});
		expect(result).toMatchObject({
			contextDevEnabled: true,
			error: null,
			results: [
				{
					title: "Amazon ECS deployment circuit breaker",
					content: expect.stringMatching(/\.\.\.$/),
				},
			],
		});
	});

	it("rejects a source domain that is not a public hostname", async () => {
		const { searchExternalDocsTool } = await import("@/lib/deploymentAgent/tools/searchExternalDocs");

		await expect(
			searchExternalDocsTool.execute(
				{ userID: "user-1" },
				{ query: "ECS deployment circuit breaker", sourceDomain: "localhost" }
			)
		).rejects.toThrow(/public hostname/i);
	});
});
