import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeComposeRelativePath, safeResolveUnderRepoRoot } from "@/lib/repoPathUtils";

describe("repoPathUtils", () => {
	it("safeResolveUnderRepoRoot resolves dot to repo root", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sd-safe-"));
		fs.writeFileSync(path.join(root, "marker.txt"), "x");
		const { absPath, relPosix } = safeResolveUnderRepoRoot(root, ".");
		expect(relPosix).toBe(".");
		expect(absPath).toBe(path.resolve(root));
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects path traversal", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "sd-escape-"));
		expect(() => safeResolveUnderRepoRoot(root, "../outside")).toThrow(/escapes/);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("normalizeComposeRelativePath rejects ..", () => {
		expect(() => normalizeComposeRelativePath("../evil.yml")).toThrow();
	});
});
