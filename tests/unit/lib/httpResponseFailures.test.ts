import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepoRecords, saveDeploymentAnalysis } from "@/lib/graphqlClient";
import { getRepoFilePaths } from "@/github-helper";

afterEach(() => vi.restoreAllMocks());

describe("upstream response failure boundaries", () => {
	it("reports a non-JSON GraphQL HTTP failure instead of a JSON syntax error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Unavailable</html>", { status: 503 }));
		await expect(fetchRepoRecords()).rejects.toThrow("GraphQL request failed (503)");
	});

	it("rejects a null GraphQL success payload with a clear protocol error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(null));
		await expect(fetchRepoRecords()).rejects.toThrow("GraphQL response missing data");
	});

	it("does not report analysis as saved when a successful HTTP response is malformed", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not JSON"));
		await expect(saveDeploymentAnalysis({ repoName: "app", serviceName: "web", scanResults: {} })).rejects.toThrow("Analysis response missing a response ID");
	});

	it("does not turn denied repository access into a successful empty repository", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Resource not accessible" }, { status: 403 }));
		await expect(getRepoFilePaths("team/app", "main", "local-test-token")).rejects.toThrow("Resource not accessible");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects incomplete repository trees before inspection can use partial metadata", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ tree: [], truncated: true }));
		await expect(getRepoFilePaths("team/app", "main", "local-test-token")).rejects.toThrow("Repository file tree is incomplete");
	});

	it.each([null, { tree: null }, { tree: [{ type: "blob" }] }])("rejects malformed successful tree payloads", async (body) => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
		await expect(getRepoFilePaths("team/app", "main", "local-test-token")).rejects.toThrow("Repository file tree response was invalid");
	});

	it("does not silently omit an important file when its content request fails", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ tree: [{ type: "blob", path: "package.json" }] }))
			.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		await expect(getRepoFilePaths("team/app", "main", "local-test-token")).rejects.toThrow("Repository file request failed (503)");
	});

	it("preserves GraphQL application errors on both HTTP errors and successful transports", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ errors: [{ message: "Permission denied" }] }, { status: 403 }))
			.mockResolvedValueOnce(Response.json({ errors: [{ message: "Query failed" }], data: null }));
		await expect(fetchRepoRecords()).rejects.toThrow("Permission denied");
		await expect(fetchRepoRecords()).rejects.toThrow("Query failed");
	});

	it("accepts complete GraphQL and nullable analysis-ID responses", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ data: { repoRecords: [] } }))
			.mockResolvedValueOnce(Response.json({ responseId: null }));
		await expect(fetchRepoRecords()).resolves.toEqual([]);
		await expect(saveDeploymentAnalysis({ repoName: "app", serviceName: "web", scanResults: {} })).resolves.toEqual({ responseId: null });
	});

	it("reads required files from the selected branch and retains empty file contents", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ tree: [{ type: "blob", path: "package.json" }], truncated: false }))
			.mockResolvedValueOnce(new Response(""));
		await expect(getRepoFilePaths("team/app", "feature/tools", "local-test-token")).resolves.toEqual({ filePaths: ["package.json"], fileContents: { "package.json": "" } });
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/team/app/git/trees/feature%2Ftools?recursive=1");
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.github.com/repos/team/app/contents/package.json?ref=feature%2Ftools");
	});
});
