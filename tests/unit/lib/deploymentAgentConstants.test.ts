import { describe, expect, it } from "vitest";
import { MAX_TOOL_CALLS } from "@/lib/deploymentAgent/constants";

describe("deploymentAgent constants", () => {
	it("allows six regular tool calls per question", () => {
		expect(MAX_TOOL_CALLS).toBe(6);
	});
});
