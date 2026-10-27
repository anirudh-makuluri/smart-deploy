import { describe, expect, it } from "vitest";
import { listenerArnFromOutput } from "../../../src/lib/aws/listenerOutput";

describe("AWS listener output validation", () => {
	it("selects the listener by port", () => {
		const raw = JSON.stringify({
			Listeners: [
				{ Port: 80, ListenerArn: "http-arn" },
				{ Port: 443, ListenerArn: "https-arn", Protocol: "HTTPS" },
			],
		});
		expect(listenerArnFromOutput(raw, 443)).toBe("https-arn");
		expect(listenerArnFromOutput(raw, 8443)).toBeNull();
	});
	it.each([
		"",
		"{",
		"null",
		"[]",
		"{}",
		'{"Listeners":{}}',
		'{"Listeners":[{"Port":443}]}',
		'{"Listeners":[{"Port":"443","ListenerArn":"bad"}]}',
	])("rejects malformed listener evidence (%#)", (raw) => {
		expect(listenerArnFromOutput(raw, 443)).toBeNull();
	});
});
