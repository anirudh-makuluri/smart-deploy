import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllPlatformDocChunksMock = vi.fn();

vi.mock("@/lib/platformDocsCore", () => ({
	getAllPlatformDocChunks: getAllPlatformDocChunksMock,
}));

describe("platformDocsMoss", () => {
	const originalEnv = {
		MOSS_PROJECT_ID: process.env.MOSS_PROJECT_ID,
		MOSS_PROJECT_KEY: process.env.MOSS_PROJECT_KEY,
		MOSS_DOCS_INDEX_NAME: process.env.MOSS_DOCS_INDEX_NAME,
		MOSS_HELP_AGENT_INDEX_NAME: process.env.MOSS_HELP_AGENT_INDEX_NAME,
	};

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.MOSS_PROJECT_ID = "project";
		process.env.MOSS_PROJECT_KEY = "key";
		delete process.env.MOSS_DOCS_INDEX_NAME;
		delete process.env.MOSS_HELP_AGENT_INDEX_NAME;
		getAllPlatformDocChunksMock.mockResolvedValue([]);
	});

	afterEach(() => {
		process.env.MOSS_PROJECT_ID = originalEnv.MOSS_PROJECT_ID;
		process.env.MOSS_PROJECT_KEY = originalEnv.MOSS_PROJECT_KEY;
		process.env.MOSS_DOCS_INDEX_NAME = originalEnv.MOSS_DOCS_INDEX_NAME;
		process.env.MOSS_HELP_AGENT_INDEX_NAME = originalEnv.MOSS_HELP_AGENT_INDEX_NAME;
	});

	it("returns no Moss chunks when the native binding cannot be loaded", async () => {
		vi.doMock("@moss-dev/moss-core", () => {
			throw new Error("ERR_DLOPEN_FAILED: GLIBC_2.38 not found");
		});

		const { getMossPlatformDocsContext } = await import("@/lib/platformDocsMoss");
		const result = await getMossPlatformDocsContext("why is the worker failing", 4);

		expect(result).toEqual([]);
		expect(getAllPlatformDocChunksMock).not.toHaveBeenCalled();
	});
});
