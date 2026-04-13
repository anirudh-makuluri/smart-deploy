import { describe, expect, it } from "vitest";
import { posthogPageType } from "@/lib/analytics/posthogPageType";

describe("posthogPageType", () => {
	it("classifies known routes", () => {
		expect(posthogPageType("/")).toBe("landing");
		expect(posthogPageType("")).toBe("landing");
		expect(posthogPageType("/docs")).toBe("docs");
		expect(posthogPageType("/docs/foo")).toBe("docs");
		expect(posthogPageType("/changelog")).toBe("changelog");
		expect(posthogPageType("/auth")).toBe("auth");
		expect(posthogPageType("/waiting-list")).toBe("waiting_list");
		expect(posthogPageType("/home")).toBe("app_home");
	});

	it("classifies owner/repo workspace", () => {
		expect(posthogPageType("/acme/api")).toBe("repo_workspace");
	});

	it("uses other for reserved top-level", () => {
		expect(posthogPageType("/api/foo")).toBe("other");
	});
});
