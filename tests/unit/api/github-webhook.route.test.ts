import { beforeEach, describe, expect, it, vi } from "vitest";

const claimGithubWebhookDeliveryMock = vi.fn();
const releaseGithubWebhookDeliveryMock = vi.fn();
const getGithubAppConfigMock = vi.fn();
const verifyGithubWebhookSignatureMock = vi.fn();
const queueGithubPushDeploymentsMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		claimGithubWebhookDelivery: (...args: unknown[]) => claimGithubWebhookDeliveryMock(...args),
		releaseGithubWebhookDelivery: (...args: unknown[]) => releaseGithubWebhookDeliveryMock(...args),
	},
}));

vi.mock("@/lib/githubApp", () => ({
	getGithubAppConfig: (...args: unknown[]) => getGithubAppConfigMock(...args),
	verifyGithubWebhookSignature: (...args: unknown[]) => verifyGithubWebhookSignatureMock(...args),
}));

vi.mock("@/lib/githubAutoDeploy", () => ({
	queueGithubPushDeployments: (...args: unknown[]) => queueGithubPushDeploymentsMock(...args),
}));

const pushPayload = {
	ref: "refs/heads/main",
	after: "c".repeat(40),
	installation: { id: 42 },
	repository: {
		id: 99,
		full_name: "acme/shop",
		html_url: "https://github.com/acme/shop",
	},
};

describe("POST /api/github/webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getGithubAppConfigMock.mockReturnValue({ webhookSecret: "secret" });
		verifyGithubWebhookSignatureMock.mockReturnValue(true);
		claimGithubWebhookDeliveryMock.mockResolvedValue({ claimed: true });
		queueGithubPushDeploymentsMock.mockResolvedValue({ queuedRuns: 1, skippedDeployments: 0 });
	});

	it("queues a signed push delivery once", async () => {
		const { POST } = await import("@/app/api/github/webhook/route");
		const response = await POST(new Request("http://localhost/api/github/webhook", {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=valid",
				"x-github-event": "push",
				"x-github-delivery": "delivery-1",
			},
			body: JSON.stringify(pushPayload),
		}));

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ accepted: true, queuedRuns: 1, skippedDeployments: 0 });
		expect(claimGithubWebhookDeliveryMock).toHaveBeenCalledWith({ deliveryId: "delivery-1", eventName: "push" });
		expect(queueGithubPushDeploymentsMock).toHaveBeenCalledWith(expect.objectContaining({
			installationId: 42,
			commitSha: "c".repeat(40),
		}));
	});

	it("rejects invalid signatures before touching the database", async () => {
		verifyGithubWebhookSignatureMock.mockReturnValue(false);
		const { POST } = await import("@/app/api/github/webhook/route");
		const response = await POST(new Request("http://localhost/api/github/webhook", {
			method: "POST",
			headers: { "x-github-event": "push" },
			body: JSON.stringify(pushPayload),
		}));

		expect(response.status).toBe(401);
		expect(claimGithubWebhookDeliveryMock).not.toHaveBeenCalled();
	});

	it("releases a delivery claim when queueing fails so GitHub can retry", async () => {
		queueGithubPushDeploymentsMock.mockRejectedValue(new Error("SQS unavailable"));
		const { POST } = await import("@/app/api/github/webhook/route");
		const response = await POST(new Request("http://localhost/api/github/webhook", {
			method: "POST",
			headers: {
				"x-hub-signature-256": "sha256=valid",
				"x-github-event": "push",
				"x-github-delivery": "delivery-1",
			},
			body: JSON.stringify(pushPayload),
		}));

		expect(response.status).toBe(500);
		expect(releaseGithubWebhookDeliveryMock).toHaveBeenCalledWith("delivery-1");
	});
});
