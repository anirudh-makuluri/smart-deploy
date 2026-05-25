import { describe, expect, it } from "vitest";
import { buildArtifactRemediationFeedbackPayload } from "@/lib/remediationFeedback";

describe("buildArtifactRemediationFeedbackPayload", () => {
	it("builds a feedback payload for sd-artifacts from structured AI analysis", () => {
		const payload = buildArtifactRemediationFeedbackPayload({
			deployConfig: {
				url: "https://github.com/acme/smart-deploy",
				commitSha: "abc123",
				scanResults: { commit_sha: "abc123" },
			} as any,
			analysis: {
				summary: "Deployment failed because nginx pointed to the wrong upstream.",
				rootCause: "nginx upstream mismatch",
				evidence: ["nginx returned 502", "upstream connection refused"],
				concreteFixInstructions: "Update nginx upstream references to use the detected service port 8080.",
				failedArtifactScope: "nginx",
				expectedOutcome: "Proxy traffic correctly to the application container.",
			},
			failureLogs: "Deploy: nginx 502\nDeploy: proxy_pass upstream failed",
			packagePath: ".",
		});

		expect(payload).not.toBeNull();
		expect(payload?.repoUrl).toBe("https://github.com/acme/smart-deploy");
		expect(payload?.commitSha).toBe("abc123");
		expect(payload?.failedArtifactScope).toBe("nginx");
		expect(payload?.feedback).toContain("Do not edit application source code.");
		expect(payload?.feedback).toContain("Focus area: nginx.");
		expect(payload?.feedback).toContain("Concrete fix instructions:");
		expect(payload?.feedback).toContain("detected service port 8080");
	});

	it("returns null when repo url or commit sha is missing", () => {
		const payload = buildArtifactRemediationFeedbackPayload({
			deployConfig: {
				url: "",
				commitSha: null,
				scanResults: {},
			} as any,
			analysis: {
				summary: "failure",
				rootCause: "failure",
				evidence: [],
				concreteFixInstructions: "retry",
				failedArtifactScope: "general",
			},
		});

		expect(payload).toBeNull();
	});
});
