import { describe, expect, it } from "vitest";
import {
	collectBuildLogSources,
	parseBuildLogExcerpt,
	resolveBuildVerificationUiStatus,
} from "@/lib/buildVerificationLogs";

describe("resolveBuildVerificationUiStatus", () => {
	it("maps verification and build status", () => {
		expect(resolveBuildVerificationUiStatus("passed", { status: "passed" })).toBe("passed");
		expect(resolveBuildVerificationUiStatus("skipped", { status: "skipped" })).toBe("skipped");
		expect(resolveBuildVerificationUiStatus("failed", { status: "failed" })).toBe("failed");
	});
});

describe("collectBuildLogSources", () => {
	it("dedupes identical verification and repair excerpts", () => {
		const excerpt = "line one\nline two";
		const sources = collectBuildLogSources(
			{ log_excerpt: excerpt, status: "passed" },
			[{ attempt: 1, result: "passed", build_log_excerpt: excerpt }],
		);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.id).toBe("verification");
	});

	it("keeps distinct repair attempts", () => {
		const sources = collectBuildLogSources(null, [
			{ attempt: 1, result: "failed", build_log_excerpt: "first failure" },
			{ attempt: 2, result: "passed", build_log_excerpt: "second success" },
		]);
		expect(sources).toHaveLength(2);
	});
});

describe("parseBuildLogExcerpt", () => {
	it("splits railpack output into log lines", () => {
		expect(parseBuildLogExcerpt("╭─────────────────╮\n│ Railpack 0.26.1 │")).toEqual([
			{ message: "╭─────────────────╮" },
			{ message: "│ Railpack 0.26.1 │" },
		]);
	});
});
