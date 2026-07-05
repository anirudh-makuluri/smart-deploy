import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/runtimeSecretEnv";

describe("runtime secret env parsing", () => {
	it("parses JSON object secrets into string env values", () => {
		expect(
			__testing.parseSecretString(
				JSON.stringify({
					DATABASE_URL: "postgres://example",
					ROUTE53_USE_WILDCARD: true,
					EMPTY: "",
					SKIP_NULL: null,
				})
			)
		).toEqual({
			DATABASE_URL: "postgres://example",
			ROUTE53_USE_WILDCARD: "true",
			EMPTY: "",
		});
	});

	it("parses dotenv-style secrets", () => {
		expect(
			__testing.parseSecretString(`
DATABASE_URL=postgres://example
NEXT_PUBLIC_DEPLOYMENT_DOMAIN="smart-deploy.xyz"
# ignored
ROUTE53_USE_WILDCARD=true
`)
		).toEqual({
			DATABASE_URL: "postgres://example",
			NEXT_PUBLIC_DEPLOYMENT_DOMAIN: "smart-deploy.xyz",
			ROUTE53_USE_WILDCARD: "true",
		});
	});
});
