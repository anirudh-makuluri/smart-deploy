import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const getDeploymentMock = vi.fn();
const runCommandMock = vi.fn();
const ec2SendMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeployment: (...args: unknown[]) => getDeploymentMock(...args),
	},
}));

vi.mock("@/server-helper", () => ({
	runCommandLiveWithOutput: (...args: unknown[]) => runCommandMock(...args),
}));

vi.mock("@/config", () => ({
	default: {
		AWS_REGION: "us-west-2",
		AWS_ACCESS_KEY_ID: "",
		AWS_SECRET_ACCESS_KEY: "",
		GCP_PROJECT_ID: "proj-1",
	},
}));

vi.mock("@aws-sdk/client-ec2", () => ({
	EC2Client: class {
		send = (...args: unknown[]) => ec2SendMock(...args);
	},
	StopInstancesCommand: class {
		constructor(public input: unknown) {}
	},
	StartInstancesCommand: class {
		constructor(public input: unknown) {}
	},
}));

describe("PUT /api/deployment-control", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 400 when action is missing", async () => {
		const { PUT } = await import("@/app/api/deployment-control/route");
		const res = await PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify({}) }) as any);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Missing action" });
	});

	it("returns 401 for repo/service control when session missing", async () => {
		getServerSessionMock.mockResolvedValue(undefined);
		const { PUT } = await import("@/app/api/deployment-control/route");
		const res = await PUT(new Request("http://localhost", {
			method: "PUT",
			body: JSON.stringify({ action: "pause", repoName: "repo", serviceName: "svc" }),
		}) as any);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Unauthorized" });
	});

	it("pauses EC2 deployment for valid owner", async () => {
		getServerSessionMock.mockResolvedValue({ userID: "u-1" });
		getDeploymentMock.mockResolvedValue({
			deployment: {
				ownerID: "u-1",
				deploymentTarget: "ec2",
				cloudProvider: "aws",
				ec2: { instanceId: "i-123" },
				awsRegion: "us-east-1",
			},
			error: null,
		});
		ec2SendMock.mockResolvedValue({});

		const { PUT } = await import("@/app/api/deployment-control/route");
		const res = await PUT(new Request("http://localhost", {
			method: "PUT",
			body: JSON.stringify({ action: "pause", repoName: "repo", serviceName: "svc" }),
		}) as any);
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.status).toBe("success");
		expect(body.message).toContain("stopping");
		expect(ec2SendMock).toHaveBeenCalledOnce();
	});

	it("uses legacy command flow for stop action", async () => {
		runCommandMock.mockResolvedValue("deleted");
		const { PUT } = await import("@/app/api/deployment-control/route");
		const res = await PUT(new Request("http://localhost", {
			method: "PUT",
			body: JSON.stringify({ action: "stop", serviceName: "svc" }),
		}) as any);
		expect(res.status).toBe(200);
		expect(runCommandMock).toHaveBeenCalledWith(
			"gcloud",
			expect.arrayContaining(["run", "services", "delete", "svc"])
		);
	});
});
