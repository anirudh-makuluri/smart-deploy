import { describe, expect, it } from "vitest";
import {
	canonicalDockerfileDeployPath,
	inferSingleDockerfileBuild,
	isSafeRepoRelPathForShell,
	isValidRepoRelativeDockerfilePath,
	syncDockerfilePathInCompose,
} from "@/lib/dockerfileDeployPath";

describe("dockerfileDeployPath", () => {
	it("normalizes dockerfile paths", () => {
		expect(canonicalDockerfileDeployPath("client")).toBe("client/Dockerfile");
		expect(canonicalDockerfileDeployPath("./client\\Dockerfile.prod")).toBe("client/Dockerfile.prod");
		expect(canonicalDockerfileDeployPath("")).toBe("Dockerfile");
	});

	it("validates repo-relative path constraints", () => {
		expect(isValidRepoRelativeDockerfilePath("apps/api/Dockerfile")).toBe(true);
		expect(isValidRepoRelativeDockerfilePath("../outside")).toBe(false);
		expect(isValidRepoRelativeDockerfilePath("C:/tmp/file")).toBe(false);
		expect(isSafeRepoRelPathForShell("apps/api-1.0/Dockerfile")).toBe(true);
		expect(isSafeRepoRelPathForShell("apps/api;rm -rf")).toBe(false);
	});

	it("infers single dockerfile build from record keys", () => {
		const result = inferSingleDockerfileBuild({ "services/web": "FROM node:20" }, null);
		expect(result).toEqual({ dockerfile: "services/web/Dockerfile", context: "services/web" });
	});

	it("infers from lone service hint when dockerfiles map is empty", () => {
		const result = inferSingleDockerfileBuild({}, [{ dockerfile_path: "apps/api", build_context: "." }]);
		expect(result).toEqual({ dockerfile: "apps/api/Dockerfile", context: "." });
	});

	it("returns null for unsafe inferred context", () => {
		const result = inferSingleDockerfileBuild({}, [{ dockerfile_path: "apps/api", build_context: "../bad" }]);
		expect(result).toBeNull();
	});

	it("syncs dockerfile path references inside compose file", () => {
		const compose = [
			"services:",
			"  web:",
			"    build:",
			"      context: .",
			"      dockerfile: client",
			"",
		].join("\n");

		const updated = syncDockerfilePathInCompose(compose, "client", "client/Dockerfile");
		expect(updated).toContain("dockerfile: client/Dockerfile");
	});
});
