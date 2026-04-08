import { describe, expect, it } from "vitest";
import { generateRuleBasedNginxConf } from "@/lib/nginxConf";

describe("generateRuleBasedNginxConf", () => {
	it("uses the given port when valid", () => {
		const conf = generateRuleBasedNginxConf(4321);
		expect(conf).toContain("proxy_pass http://127.0.0.1:4321;");
	});

	it("falls back to 8080 for invalid ports", () => {
		expect(generateRuleBasedNginxConf("abc")).toContain("127.0.0.1:8080");
		expect(generateRuleBasedNginxConf(0)).toContain("127.0.0.1:8080");
	});
});
