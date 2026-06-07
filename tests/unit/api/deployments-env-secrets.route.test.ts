import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getDeploymentMock = vi.fn();
const updateDeploymentsMock = vi.fn();
const getDeploymentEnvSecretEntriesMock = vi.fn();
const upsertDeploymentEnvSecretMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeployment: (...args: unknown[]) => getDeploymentMock(...args),
		updateDeployments: (...args: unknown[]) => updateDeploymentsMock(...args),
	},
}));

vi.mock("@/lib/aws/deploymentSecrets", () => ({
	getDeploymentEnvSecretEntries: (...args: unknown[]) => getDeploymentEnvSecretEntriesMock(...args),
	upsertDeploymentEnvSecret: (...args: unknown[]) => upsertDeploymentEnvSecretMock(...args),
}));

const baseDeployment = {
	repoName: "acme",
	serviceName: "web",
	ownerID: "user-1",
	region: "us-west-2",
	secretsArn: "arn:aws:secretsmanager:us-west-2:123:secret:test",
};

describe("/api/deployments/env-secrets", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET returns 401 when unauthorized", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/deployments/env-secrets/route");
		const res = await GET(new Request("http://localhost/api/deployments/env-secrets?repoName=acme&serviceName=web"));
		expect(res.status).toBe(401);
	});

	it("GET returns stored entries for owned deployment", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		getDeploymentMock.mockResolvedValue({ deployment: baseDeployment });
		getDeploymentEnvSecretEntriesMock.mockResolvedValue([{ name: "API_KEY", value: "secret" }]);

		const { GET } = await import("@/app/api/deployments/env-secrets/route");
		const res = await GET(new Request("http://localhost/api/deployments/env-secrets?repoName=acme&serviceName=web"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			secretsArn: baseDeployment.secretsArn,
			entries: [{ name: "API_KEY", value: "secret" }],
		});
	});

	it("PUT saves secrets and persists secretsArn", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
		getDeploymentMock.mockResolvedValue({ deployment: { ...baseDeployment, secretsArn: null } });
		upsertDeploymentEnvSecretMock.mockResolvedValue({ secretsArn: "arn:new" });
		updateDeploymentsMock.mockResolvedValue({ success: "ok" });

		const { PUT } = await import("@/app/api/deployments/env-secrets/route");
		const res = await PUT(
			new Request("http://localhost/api/deployments/env-secrets", {
				method: "PUT",
				body: JSON.stringify({
					repoName: "acme",
					serviceName: "web",
					entries: [{ name: "API_KEY", value: "secret" }],
				}),
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, secretsArn: "arn:new", entryCount: 1 });
		expect(updateDeploymentsMock).toHaveBeenCalledWith(
			expect.objectContaining({ secretsArn: "arn:new" }),
			"user-1"
		);
	});
});
