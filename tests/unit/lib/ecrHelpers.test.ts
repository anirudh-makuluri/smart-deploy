import { describe, expect, it } from "vitest";
import { buildScopedEcrRepoName } from "@/lib/aws/ecrHelpers";

describe("buildScopedEcrRepoName", () => {
	it("uses the sd prefix for repo-root deploys", () => {
		expect(buildScopedEcrRepoName("smart-deploy", ".")).toBe("sd/smart-deploy");
		expect(buildScopedEcrRepoName("smart-deploy")).toBe("sd/smart-deploy");
	});

	it("adds package_path for scoped monorepo deploys", () => {
		expect(buildScopedEcrRepoName("smart-deploy", "apps/web")).toBe("sd/smart-deploy/apps/web");
	});

	it("normalizes repo and package path segments into valid ECR paths", () => {
		expect(buildScopedEcrRepoName("Smart Deploy", "./Apps/Admin UI/")).toBe("sd/smart-deploy/apps/admin-ui");
	});
});
