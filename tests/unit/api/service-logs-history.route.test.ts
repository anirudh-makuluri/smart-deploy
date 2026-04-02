import { beforeEach, describe, expect, it, vi } from "vitest";

const getDeploymentMock = vi.fn();
const getInitialEc2ServiceLogsMock = vi.fn();
const getInitialLogsMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		getDeployment: (...args: unknown[]) => getDeploymentMock(...args),
	},
}));

vi.mock("@/lib/aws/ec2ServiceLogs", () => ({
	getInitialEc2ServiceLogs: (...args: unknown[]) => getInitialEc2ServiceLogsMock(...args),
}));

vi.mock("@/gcloud-logs/getInitialLogs", () => ({
	getInitialLogs: (...args: unknown[]) => getInitialLogsMock(...args),
}));

describe("GET /api/service-logs-history", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 400 when serviceName is missing", async () => {
		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = { nextUrl: new URL("http://localhost/api/service-logs-history") } as any;
		const res = await GET(req);
		expect(res.status).toBe(400);
	});

	it("uses EC2 logs when deployment has instanceId", async () => {
		getDeploymentMock.mockResolvedValue({
			deployment: {
				ec2: { instanceId: "i-123" },
				awsRegion: "us-east-1",
			},
		});
		getInitialEc2ServiceLogsMock.mockResolvedValue([{ message: "ec2 log" }]);

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?repoName=repo&serviceName=web&limit=20"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ logs: [{ message: "ec2 log" }] });
	});

	it("falls back to gcloud logs when no EC2 instance is present", async () => {
		getDeploymentMock.mockResolvedValue({ deployment: {} });
		getInitialLogsMock.mockResolvedValue([{ message: "gcp log" }]);

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?repoName=repo&serviceName=web"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ logs: [{ message: "gcp log" }] });
	});

	it("returns 500 when provider throws", async () => {
		getDeploymentMock.mockResolvedValue({ deployment: {} });
		getInitialLogsMock.mockRejectedValue(new Error("provider down"));

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?serviceName=web"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(500);
	});
});
