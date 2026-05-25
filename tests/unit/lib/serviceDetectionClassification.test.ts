import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyServiceForDetection } from "@/lib/serviceDetectionClassification";

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("classifyServiceForDetection", () => {
	it("classifies Vite apps as direct-static", () => {
		const dir = tempDir("sd-classify-vite-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "18.0.0", vite: "5.0.0" },
				scripts: { build: "vite build" },
			})
		);

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
			framework: "react",
		});

		expect(result).toEqual({ deployMode: "direct-static", serviceType: "vite" });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("classifies CRA apps as direct-static", () => {
		const dir = tempDir("sd-classify-cra-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { react: "18.0.0", "react-scripts": "5.0.0" },
				scripts: { build: "react-scripts build" },
			})
		);

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
			framework: "react",
		});

		expect(result).toEqual({ deployMode: "direct-static", serviceType: "cra" });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("classifies Next.js export as direct-static", () => {
		const dir = tempDir("sd-classify-next-export-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
				scripts: { build: "next build" },
			})
		);
		fs.writeFileSync(path.join(dir, "next.config.js"), "module.exports = { output: 'export' };");

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
			framework: "nextjs",
		});

		expect(result).toEqual({ deployMode: "direct-static", serviceType: "next-export" });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("keeps non-export Next.js on the container path", () => {
		const dir = tempDir("sd-classify-next-ssr-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
				scripts: { build: "next build" },
			})
		);

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
			framework: "nextjs",
		});

		expect(result).toEqual({ deployMode: "container" });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("keeps Dockerfile-backed services on the container path", () => {
		const dir = tempDir("sd-classify-docker-");
		fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20-alpine");

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
			dockerfile: "Dockerfile",
			framework: "react",
		});

		expect(result).toEqual({ deployMode: "container" });
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("classifies plain html sites as direct-static", () => {
		const dir = tempDir("sd-classify-static-html-");
		fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html><body>Hello</body></html>");

		const result = classifyServiceForDetection(dir, {
			relativePath: ".",
			workdir: dir,
		});

		expect(result).toEqual({ deployMode: "direct-static", serviceType: "static-html" });
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
