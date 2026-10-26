import { afterEach, describe, expect, it, vi } from "vitest";
import { requestFailureAnalysis } from "../../../src/lib/failureAnalysis";

afterEach(() => vi.unstubAllGlobals());
describe("failure analysis response handling", () => {
	it("returns successful analysis and sends only the requested run identifier", async () => {
		const fetcher = vi.fn().mockResolvedValue(Response.json({ response: "Build needs a start script." }));
		vi.stubGlobal("fetch", fetcher);
		expect(await requestFailureAnalysis("run-one")).toBe("Build needs a start script.");
		expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ runId: "run-one" });
	});
	it("does not treat a success-shaped HTTP error as successful analysis", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ response: "misleading success", error: "Analysis unavailable" }, { status: 503 }),
				),
		);
		await expect(requestFailureAnalysis("run-one")).rejects.toThrow("Analysis unavailable");
	});
	it("preserves error details", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ details: "Run is still being saved" }, { status: 409 })),
		);
		await expect(requestFailureAnalysis("run-one")).rejects.toThrow("Run is still being saved");
	});
	it("handles a non-JSON error response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 502 })));
		await expect(requestFailureAnalysis("run-one")).rejects.toThrow("Analysis failed.");
	});
	it("handles an invalid success payload without rendering arbitrary values", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ response: { secret: "not text" } })));
		expect(await requestFailureAnalysis("run-one")).toBe("Analysis failed.");
	});
});
