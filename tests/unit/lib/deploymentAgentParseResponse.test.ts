import { describe, expect, it } from "vitest";
import { parseAgentResponseJson } from "@/lib/deploymentAgent/parseAgentResponse";

describe("parseAgentResponseJson", () => {
	it("parses plain JSON responses", () => {
		const parsed = parseAgentResponseJson(
			JSON.stringify({
				message: "Checking deployments.",
				tool_calls: [{ name: "list_deployments", arguments: {} }],
				completed: false,
			})
		);

		expect(parsed).toMatchObject({
			message: "Checking deployments.",
			completed: false,
		});
	});

	it("parses fenced JSON responses", () => {
		const parsed = parseAgentResponseJson(
			[
				"Here is the response:",
				"```json",
				JSON.stringify({
					message: "Done.",
					tool_calls: [],
					completed: true,
				}),
				"```",
			].join("\n")
		);

		expect(parsed).toMatchObject({
			message: "Done.",
			completed: true,
			tool_calls: [],
		});
	});

	it("extracts JSON objects from leading prose", () => {
		const parsed = parseAgentResponseJson(
			[
				"Railpack is Smart Deploy's default build system.",
				JSON.stringify({
					message: "Railpack builds container images during deploy.",
					tool_calls: [],
					completed: true,
				}),
			].join("\n")
		);

		expect(parsed).toMatchObject({
			message: "Railpack builds container images during deploy.",
			completed: true,
		});
	});

	it("rejects schema-invalid responses", () => {
		const parsed = parseAgentResponseJson(
			JSON.stringify({
				message: "   ",
				tool_calls: [],
				completed: true,
			})
		);

		expect(parsed).toBeNull();
	});

	it("rejects prose-only responses", () => {
		const parsed = parseAgentResponseJson("Railpack is the default build system on Smart Deploy.");
		expect(parsed).toBeNull();
	});
});