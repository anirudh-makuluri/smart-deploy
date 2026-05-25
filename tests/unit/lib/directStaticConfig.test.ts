import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDirectStaticScanResults } from "@/lib/directStaticConfig";

const tempDirs: string[] = [];

function makeTempRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "direct-static-config-test-"));
	tempDirs.push(dir);
	return dir;
}

function writeJson(filePath: string, value: unknown) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

describe("buildDirectStaticScanResults", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prefills a Vite app from package.json scripts and pnpm lockfile", () => {
		const repoRoot = makeTempRepo();
		writeJson(path.join(repoRoot, "apps/web/package.json"), {
			devDependencies: {
				vite: "^5.0.0",
			},
			scripts: {
				build: "vite build",
			},
		});
		fs.writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");

		const result = buildDirectStaticScanResults(repoRoot, "apps/web", "vite");

		expect(result.package_manager).toBe("pnpm");
		expect(result.install).toEqual(["pnpm install --frozen-lockfile"]);
		expect(result.build).toEqual(["pnpm build"]);
		expect(result.output_dir).toBe("dist");
		expect(result.spa_fallback).toBe(true);
		expect(result.workdir).toBe("apps/web");
	});

	it("uses out and disables spa fallback for next export", () => {
		const repoRoot = makeTempRepo();
		writeJson(path.join(repoRoot, "package.json"), {
			dependencies: {
				next: "^15.0.0",
			},
			scripts: {
				build: "next build",
			},
			packageManager: "yarn@4.0.0",
		});

		const result = buildDirectStaticScanResults(repoRoot, ".", "next-export");

		expect(result.package_manager).toBe("yarn");
		expect(result.build).toEqual(["yarn build"]);
		expect(result.output_dir).toBe("out");
		expect(result.spa_fallback).toBe(false);
		expect(result.nginx_conf).toContain("try_files $uri $uri/ =404;");
	});

	it("keeps plain static html repos command-free and serves from repo root", () => {
		const repoRoot = makeTempRepo();
		fs.writeFileSync(path.join(repoRoot, "index.html"), "<!doctype html><html></html>");

		const result = buildDirectStaticScanResults(repoRoot, ".", "static-html");

		expect(result.install).toEqual([]);
		expect(result.build).toEqual([]);
		expect(result.output_dir).toBe(".");
		expect(result.nginx_conf).toContain("root /var/www/app;");
	});
});
