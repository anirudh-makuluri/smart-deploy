import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectMultiService, discoverServiceCatalog } from "@/lib/multiServiceDetector";

function tempDir(prefix: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

afterEach(() => {
	// tests clean up their dirs
});

describe("detectMultiService root app", () => {
	it("detects a standalone Next.js app at repo root", () => {
		const dir = tempDir("sd-next-root-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "lexiguess-next",
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(1);
		expect(cfg.services[0].name).toBe("lexiguess-next");
		expect(cfg.services[0].framework).toBe("nextjs");
		expect(cfg.services[0].port).toBe(3000);
		expect(cfg.services[0].relativePath).toBe(".");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("uses fallback name app when package.json has no name", () => {
		const dir = tempDir("sd-noname-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(1);
		expect(cfg.services[0].name).toBe("app");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("returns no services for an empty directory", () => {
		const dir = tempDir("sd-empty-");
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(0);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("does not treat workspace root as a single app when monorepo tooling is present", () => {
		const dir = tempDir("sd-workspace-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "mono-root",
				workspaces: ["packages/*"],
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		fs.mkdirSync(path.join(dir, "packages", "a"), { recursive: true });
		fs.writeFileSync(path.join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "a" }));
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(0);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("skips Expo / React Native at root", () => {
		const dir = tempDir("sd-expo-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "my-app",
				dependencies: { expo: "~50.0.0", react: "18.0.0" },
			})
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(0);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("uses GitHub repo slug for single root when hint is provided (stable analyze / deployment id)", () => {
		const dir = tempDir("sd-hint-root-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "wrong-npm-name",
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const cfg = detectMultiService(dir, { rootServiceNameHint: "chatify-next" });
		expect(cfg.services).toHaveLength(1);
		expect(cfg.services[0].name).toBe("chatify-next");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("prefers projects/* compose when root compose is infra-only", () => {
		const dir = tempDir("sd-projects-compose-");
		fs.writeFileSync(
			path.join(dir, "docker-compose.yml"),
			`services:
  kafka:
    image: bitnami/kafka:latest
  prometheus:
    image: prom/prometheus:latest
`
		);
		const demoApi = path.join(dir, "projects", "demo-api");
		fs.mkdirSync(demoApi, { recursive: true });
		fs.writeFileSync(
			path.join(demoApi, "docker-compose.yml"),
			`services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`
		);
		const blog = path.join(dir, "projects", "blog");
		fs.mkdirSync(blog, { recursive: true });
		fs.writeFileSync(
			path.join(blog, "docker-compose.yml"),
			`services:
  app:
    image: nginx:alpine
    ports:
      - "3000:80"
`
		);

		const cfg = detectMultiService(dir);
		expect(cfg.services.map((s) => s.name).sort()).toEqual(["blog", "demo-api"]);
		expect(cfg.services.find((s) => s.name === "demo-api")?.relativePath).toBe("projects/demo-api");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("keeps root compose when it mixes infra with an app-like service", () => {
		const dir = tempDir("sd-mixed-compose-");
		fs.writeFileSync(
			path.join(dir, "docker-compose.yml"),
			`services:
  kafka:
    image: bitnami/kafka:latest
  web:
    image: nginx:alpine
`
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services.map((s) => s.name).sort()).toEqual(["kafka", "web"]);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("discoverServiceCatalog adds one row per compose directory (root compose counts)", () => {
		const dir = tempDir("sd-catalog-compose-");
		fs.writeFileSync(
			path.join(dir, "docker-compose.yml"),
			`services:
  kafka:
    image: bitnami/kafka:latest
`
		);
		const cat = discoverServiceCatalog(dir, "my-repo");
		expect(cat.services).toHaveLength(1);
		expect(cat.services[0].name).toBe("my-repo");
		expect(cat.services[0].relativePath).toBe(".");
		expect(cat.hasDockerCompose).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("discoverServiceCatalog creates one service per compose file in different directories", () => {
		const dir = tempDir("sd-catalog-multi-compose-");
		const a = path.join(dir, "projects", "alpha");
		const b = path.join(dir, "projects", "beta");
		fs.mkdirSync(a, { recursive: true });
		fs.mkdirSync(b, { recursive: true });
		fs.writeFileSync(
			path.join(a, "docker-compose.yml"),
			`services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`
		);
		fs.writeFileSync(
			path.join(b, "compose.yml"),
			`services:
  app:
    image: nginx:alpine
    ports:
      - "3000:80"
`
		);
		const cat = discoverServiceCatalog(dir, "mono");
		expect(cat.services.length).toBeGreaterThanOrEqual(2);
		const paths = cat.services.map((s) => s.relativePath).sort();
		expect(paths).toContain("projects/alpha");
		expect(paths).toContain("projects/beta");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("detects projects/* compose when there is no root compose file", () => {
		const dir = tempDir("sd-projects-only-");
		const svcDir = path.join(dir, "projects", "svc-a");
		fs.mkdirSync(svcDir, { recursive: true });
		fs.writeFileSync(
			path.join(svcDir, "compose.yml"),
			`services:
  web:
    image: nginx:alpine
`
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(1);
		expect(cfg.services[0].name).toBe("svc-a");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("discoverServiceCatalog detects root sibling apps (api + ui) without root package.json", () => {
		const dir = tempDir("sd-catalog-siblings-");
		const api = path.join(dir, "api");
		const ui = path.join(dir, "ui");
		fs.mkdirSync(api, { recursive: true });
		fs.mkdirSync(ui, { recursive: true });
		fs.writeFileSync(path.join(api, "api.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>");
		fs.writeFileSync(
			path.join(ui, "package.json"),
			JSON.stringify({
				name: "ui",
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const cat = discoverServiceCatalog(dir, "code-craft");
		expect(cat.isMultiService).toBe(true);
		expect(cat.services).toHaveLength(2);
		const paths = cat.services.map((s) => s.relativePath).sort();
		expect(paths).toEqual(["api", "ui"]);
		const uiSvc = cat.services.find((s) => s.relativePath === "ui");
		expect(uiSvc?.framework).toBe("nextjs");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("discoverServiceCatalog adds Dockerfile-only directories with unknown language", () => {
		const dir = tempDir("sd-catalog-dockerfile-");
		const worker = path.join(dir, "worker");
		fs.mkdirSync(worker, { recursive: true });
		fs.writeFileSync(path.join(worker, "Dockerfile"), "FROM alpine:3.19\nCMD [\"sleep\",\"infinity\"]\n");
		const cat = discoverServiceCatalog(dir, "jobs");
		expect(cat.services).toHaveLength(1);
		expect(cat.services[0].relativePath).toBe("worker");
		expect(cat.services[0].dockerfile).toBe("Dockerfile");
		expect(cat.services[0].language).toBe("unknown");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("detectMultiService finds non-pattern sibling apps (gateway + bff) without root compose", () => {
		const dir = tempDir("sd-deploy-siblings-");
		const g = path.join(dir, "gateway");
		const b = path.join(dir, "bff");
		fs.mkdirSync(g, { recursive: true });
		fs.mkdirSync(b, { recursive: true });
		fs.writeFileSync(
			path.join(g, "package.json"),
			JSON.stringify({ name: "gateway", dependencies: { express: "4.0.0" } })
		);
		fs.writeFileSync(
			path.join(b, "package.json"),
			JSON.stringify({ name: "bff", dependencies: { fastify: "4.0.0" } })
		);
		const cfg = detectMultiService(dir);
		expect(cfg.isMultiService).toBe(true);
		expect(cfg.services.length).toBeGreaterThanOrEqual(2);
		const paths = cfg.services.map((s) => (s.relativePath || ".").replace(/\\/g, "/")).sort();
		expect(paths).toContain("bff");
		expect(paths).toContain("gateway");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("detectMultiService expands nested compose when root has no compose file", () => {
		const dir = tempDir("sd-deploy-nested-compose-");
		const stack = path.join(dir, "stack");
		fs.mkdirSync(stack, { recursive: true });
		fs.writeFileSync(
			path.join(stack, "docker-compose.yml"),
			`services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`
		);
		const cfg = detectMultiService(dir);
		expect(cfg.services).toHaveLength(1);
		expect(cfg.services[0].relativePath).toBe("stack");
		expect(cfg.hasDockerCompose).toBe(true);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("detectMultiService merges root Next app with sibling api (filesystem + root inject)", () => {
		const dir = tempDir("sd-deploy-root-api-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "web",
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const api = path.join(dir, "api");
		fs.mkdirSync(api, { recursive: true });
		fs.writeFileSync(
			path.join(api, "package.json"),
			JSON.stringify({ name: "api", dependencies: { express: "4.0.0" } })
		);
		const cfg = detectMultiService(dir, { rootServiceNameHint: "fullstack" });
		expect(cfg.isMultiService).toBe(true);
		expect(cfg.services).toHaveLength(2);
		const paths = cfg.services.map((s) => (s.relativePath || ".").replace(/\\/g, "/")).sort();
		expect(paths).toEqual([".", "api"]);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("discoverServiceCatalog merges root Next app with a sibling folder", () => {
		const dir = tempDir("sd-catalog-root-plus-sibling-");
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({
				name: "web",
				dependencies: { next: "14.0.0", react: "18.0.0", "react-dom": "18.0.0" },
			})
		);
		const api = path.join(dir, "api");
		fs.mkdirSync(api, { recursive: true });
		fs.writeFileSync(
			path.join(api, "package.json"),
			JSON.stringify({ name: "api", dependencies: { express: "4.0.0" } })
		);
		const cat = discoverServiceCatalog(dir, "fullstack-demo");
		expect(cat.isMultiService).toBe(true);
		expect(cat.services).toHaveLength(2);
		const paths = cat.services.map((s) => s.relativePath).sort();
		expect(paths).toEqual([".", "api"]);
		const rootSvc = cat.services.find((s) => s.relativePath === ".");
		expect(rootSvc?.framework).toBe("nextjs");
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
