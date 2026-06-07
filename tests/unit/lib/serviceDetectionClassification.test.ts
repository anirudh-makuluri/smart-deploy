import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyServiceForDetection } from "@/lib/serviceDetectionClassification";

function mkRepo(files: Record<string, string>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svc-classify-"));
	for (const [rel, content] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, "utf8");
	}
	return dir;
}

describe("classifyServiceForDetection", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		dirs.length = 0;
	});

	it("classifies Vite apps as container with serviceType hint", () => {
		const repoRoot = mkRepo({
			"package.json": JSON.stringify({
				scripts: { build: "vite build" },
				devDependencies: { vite: "^5.0.0" },
			}),
			"vite.config.ts": "export default {}",
		});
		dirs.push(repoRoot);
		const result = classifyServiceForDetection(repoRoot, { relativePath: "." });
		expect(result).toEqual({ deployMode: "container", serviceType: "vite" });
	});

	it("classifies CRA apps as container with serviceType hint", () => {
		const repoRoot = mkRepo({
			"package.json": JSON.stringify({
				scripts: { build: "react-scripts build" },
				dependencies: { "react-scripts": "5.0.0" },
			}),
		});
		dirs.push(repoRoot);
		const result = classifyServiceForDetection(repoRoot, { relativePath: "." });
		expect(result).toEqual({ deployMode: "container", serviceType: "cra" });
	});

	it("classifies Next.js export as container with serviceType hint", () => {
		const repoRoot = mkRepo({
			"package.json": JSON.stringify({
				scripts: { build: "next build" },
				dependencies: { next: "14.0.0" },
			}),
			"next.config.js": "module.exports = { output: 'export' }",
		});
		dirs.push(repoRoot);
		const result = classifyServiceForDetection(repoRoot, { relativePath: ".", framework: "nextjs" });
		expect(result).toEqual({ deployMode: "container", serviceType: "next-export" });
	});

	it("classifies Express apps as container without static hint", () => {
		const repoRoot = mkRepo({
			"package.json": JSON.stringify({
				scripts: { start: "node server.js" },
				dependencies: { express: "4.18.0" },
			}),
		});
		dirs.push(repoRoot);
		const result = classifyServiceForDetection(repoRoot, { relativePath: ".", framework: "express" });
		expect(result).toEqual({ deployMode: "container" });
	});

	it("classifies plain html sites as container with static-html hint", () => {
		const repoRoot = mkRepo({
			"index.html": "<html></html>",
		});
		dirs.push(repoRoot);
		const result = classifyServiceForDetection(repoRoot, { relativePath: "." });
		expect(result).toEqual({ deployMode: "container", serviceType: "static-html" });
	});
});
