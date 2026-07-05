import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAWSDeploymentMock = vi.fn();
const deleteRoute53DnsRecordMock = vi.fn();
const getDeploymentForUserMock = vi.fn();
const deleteDeploymentMock = vi.fn();

vi.mock("@/lib/aws/deleteAWSDeployment", () => ({
	deleteAWSDeployment: (...args: unknown[]) => deleteAWSDeploymentMock(...args),
}));

vi.mock("@/lib/route53Dns", () => ({
	deleteRoute53DnsRecord: (...args: unknown[]) => deleteRoute53DnsRecordMock(...args),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeploymentForUser: (...args: unknown[]) => getDeploymentForUserMock(...args),
		deleteDeployment: (...args: unknown[]) => deleteDeploymentMock(...args),
	},
}));

describe("deleteDeploymentForUser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes the database record when AWS resources are already gone", async () => {
		getDeploymentForUserMock.mockResolvedValue({
			deployment: {
				repoName: "repo",
				serviceName: "web",
				repoUrl: "https://github.com/acme/repo",
				branch: "main",
				commitSha: null,
				id: "dep-1",
				hostedSubdomain: "repo-web",
				deploymentTarget: "ecs",
			},
		});
		deleteAWSDeploymentMock.mockRejectedValueOnce({
			Code: "TargetGroupNotFound",
			Error: {
				Code: "TargetGroupNotFound",
				Message: "Target groups 'arn:aws:elasticloadbalancing:us-west-2:123:targetgroup/demo/abc' not found",
			},
		});
		deleteRoute53DnsRecordMock.mockResolvedValue({ success: true, deletedCount: 0 });
		deleteDeploymentMock.mockResolvedValue({ success: "Deployment deleted" });

		const { deleteDeploymentForUser } = await import("@/lib/deploymentActions");
		const result = await deleteDeploymentForUser({
			repoName: "repo",
			serviceName: "web",
			userID: "user-1",
		});

		expect(result).toEqual({
			status: "success",
			message: "Deployment deleted; no traces left.",
			dnsRecordsDeleted: 0,
		});
		expect(deleteDeploymentMock).toHaveBeenCalledWith("repo", "web", "user-1");
	});
});
