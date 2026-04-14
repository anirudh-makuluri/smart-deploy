import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const executeGraphQLOperationMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/app/api/graphql/route", () => ({
	executeGraphQLOperation: (...args: unknown[]) => executeGraphQLOperationMock(...args),
}));

describe("GET /api/service-logs-history", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when session user is missing", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = { nextUrl: new URL("http://localhost/api/service-logs-history?serviceName=web") } as any;
		const res = await GET(req);
		expect(res.status).toBe(401);
	});

	it("returns 400 when serviceName is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = { nextUrl: new URL("http://localhost/api/service-logs-history") } as any;
		const res = await GET(req);
		expect(res.status).toBe(400);
	});

	it("returns logs on success from EC2", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		executeGraphQLOperationMock.mockResolvedValue({
			serviceLogs: { logs: [{ message: "ec2 log" }], source: "ec2" },
		});

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?repoName=repo&serviceName=web&limit=20"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ logs: [{ message: "ec2 log" }] });
	});

	it("returns logs on success from GCP", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		executeGraphQLOperationMock.mockResolvedValue({
			serviceLogs: { logs: [{ message: "gcp log" }], source: "gcp" },
		});

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?serviceName=web"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ logs: [{ message: "gcp log" }] });
	});

	it("returns 500 when graphql operation fails", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		executeGraphQLOperationMock.mockRejectedValue(new Error("provider down"));

		const { GET } = await import("@/app/api/service-logs-history/route");
		const req = {
			nextUrl: new URL("http://localhost/api/service-logs-history?serviceName=web"),
		} as any;
		const res = await GET(req);
		expect(res.status).toBe(500);
	});
});
