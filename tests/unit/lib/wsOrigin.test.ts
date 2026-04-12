import { describe, expect, it } from "vitest";
import { getAllowedOriginHeader, isOriginAllowed, parseAllowedOrigins } from "@/lib/wsOrigin";

describe("wsOrigin", () => {
	it("parses a comma-separated origin allowlist", () => {
		expect(parseAllowedOrigins(" http://localhost:3000 , https://smartdeploy.example.com/ ")).toEqual([
			"http://localhost:3000",
			"https://smartdeploy.example.com",
		]);
	});

	it("allows every origin when the allowlist is empty", () => {
		expect(isOriginAllowed("http://localhost:3000", [])).toBe(true);
		expect(isOriginAllowed(undefined, [])).toBe(true);
	});

	it("rejects missing or unknown origins when the allowlist is configured", () => {
		const allowedOrigins = ["http://localhost:3000"];

		expect(isOriginAllowed(undefined, allowedOrigins)).toBe(false);
		expect(isOriginAllowed("https://smartdeploy.example.com", allowedOrigins)).toBe(false);
	});

	it("returns the normalized origin for CORS only when it is allowed", () => {
		const allowedOrigins = ["http://localhost:3000"];

		expect(getAllowedOriginHeader("http://localhost:3000/", allowedOrigins)).toBe("http://localhost:3000");
		expect(getAllowedOriginHeader("https://smartdeploy.example.com", allowedOrigins)).toBeNull();
	});
});
