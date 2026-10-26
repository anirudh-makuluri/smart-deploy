import { describe, expect, it } from "vitest";
import { documentJson, documentKey, storedDocument } from "../../../src/lib/apps/documentSchema";

const address = { appId: "11111111-1111-4111-8111-111111111111", environment: "preview" as const, collection: "orders", id: "first" };
describe("bounded app document encoding", () => {
	it("keeps nested JSON values and string big integers without prototype mutation", () => {
		const json = '{"__proto__":{"polluted":true},"values":[null,true,1.25,"9007199254740993"]}';
		expect(documentJson(json)).toBe(json);
		expect({}).not.toHaveProperty("polluted");
	});
	it("accepts exactly eight KiB and rejects one byte more", () => {
		const json = JSON.stringify({ x: "a".repeat(8184) });
		expect(Buffer.byteLength(json)).toBe(8192); expect(documentJson(json)).toBe(json);
		expect(() => documentJson(JSON.stringify({ x: "a".repeat(8185) }))).toThrow();
	});
	it("does not expose malformed stored JSON as a user input error", () => {
		expect(() => storedDocument({ ...documentKey(address), collection: address.collection, id: address.id, version: "22222222-2222-4222-8222-222222222222", json: "{broken", chargedBytes: 100 }, address)).toThrowError(expect.objectContaining({ status: 503 }));
	});
	it("rejects short exponential input whose normalized numbers exceed eight KiB", () => {
		const input = '{"values":[' + Array(1000).fill("1e-6").join(",") + ']}';
		expect(Buffer.byteLength(input)).toBe(5012); expect(Buffer.byteLength(JSON.stringify(JSON.parse(input)))).toBe(9012);
		expect(() => documentJson(input)).toThrowError(expect.objectContaining({ status: 400 }));
	});
	it("bounds normalization of lone UTF-16 surrogates as well as input bytes", () => {
		const input = '{"text":"' + "\ud800".repeat(2000) + '"}';
		expect(Buffer.byteLength(input)).toBeLessThan(8192); expect(Buffer.byteLength(JSON.stringify(JSON.parse(input)))).toBeGreaterThan(8192);
		expect(() => documentJson(input)).toThrowError(expect.objectContaining({ status: 400 }));
	});
	it("accepts normalization expansion when the stored result remains within its limit", () => {
		const input = '{"values":[' + Array(500).fill("1e-6").join(",") + ']}';
		const normalized = JSON.stringify(JSON.parse(input)); expect(Buffer.byteLength(normalized)).toBeLessThan(8192);
		expect(documentJson(input)).toBe(normalized); expect(documentJson(normalized)).toBe(normalized);
	});
	it("rejects a stored record returned under another tenant key", () => {
		expect(() => storedDocument({ ...documentKey(address), pk: "APP#another", collection: address.collection, id: address.id, version: "22222222-2222-4222-8222-222222222222", json: "{}", chargedBytes: 525 }, address)).toThrowError(expect.objectContaining({ status: 503 }));
	});
});
