import { beforeEach, describe, expect, it, vi } from "vitest";

const manageClientMock = {
	createIndex: vi.fn(),
	addDocs: vi.fn(),
	getJobStatus: vi.fn(),
};
const indexManagerMock = {
	loadIndex: vi.fn(),
	hasIndex: vi.fn(),
	queryText: vi.fn(),
};

vi.mock("@moss-dev/moss-core", () => ({
	ManageClient: vi.fn(function ManageClient() {
		return manageClientMock;
	}),
	IndexManager: vi.fn(function IndexManager() {
		return indexManagerMock;
	}),
}));

describe("platformMossRuntime", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		manageClientMock.getJobStatus.mockResolvedValue({ status: "completed" });
		manageClientMock.createIndex.mockResolvedValue({ jobId: "job-1" });
		manageClientMock.addDocs.mockResolvedValue({ jobId: "job-2" });
		indexManagerMock.hasIndex.mockResolvedValue(true);
		indexManagerMock.queryText.mockResolvedValue({
			docs: [{ id: "doc-1", text: "SOURCE: docs/FAQ.md", score: 0.9 }],
			query: "health",
		});
	});

	it("waits for mutation jobs before returning", async () => {
		const { PlatformMossRuntime } = await import("@/lib/platformMossRuntime");
		const runtime = new PlatformMossRuntime("project", "key");

		await runtime.createIndex("smart_deploy_help_docs", [{ id: "doc-1", text: "hello" }]);

		expect(manageClientMock.createIndex).toHaveBeenCalledWith(
			"smart_deploy_help_docs",
			[{ id: "doc-1", text: "hello" }],
			"moss-minilm"
		);
		expect(manageClientMock.getJobStatus).toHaveBeenCalledWith("job-1");
	});

	it("queries through IndexManager.queryText", async () => {
		const { PlatformMossRuntime } = await import("@/lib/platformMossRuntime");
		const runtime = new PlatformMossRuntime("project", "key");

		const result = await runtime.query("smart_deploy_help_docs", "runtime health", 4);

		expect(indexManagerMock.queryText).toHaveBeenCalledWith("smart_deploy_help_docs", "runtime health", 4);
		expect(result.docs).toHaveLength(1);
	});
});