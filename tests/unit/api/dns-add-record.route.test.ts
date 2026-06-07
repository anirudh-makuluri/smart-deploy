import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const addRoute53DnsRecordMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/lib/route53Dns", () => ({
	addRoute53DnsRecord: (...args: unknown[]) => addRoute53DnsRecordMock(...args),
}));

describe("POST /api/dns/add-record", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when user is unauthorized", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/dns/add-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(401);
	});

	it("returns 400 when deployUrl is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { POST } = await import("@/app/api/dns/add-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(400);
	});

	it("returns custom URL on success", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		addRoute53DnsRecordMock.mockResolvedValue({ success: true, customUrl: "https://app.example.com" });
		const { POST } = await import("@/app/api/dns/add-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ deployUrl: "https://alb.example.com", serviceName: "web" }),
			}) as any
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, customUrl: "https://app.example.com" });
	});

	it("returns 400 when dns helper fails", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		addRoute53DnsRecordMock.mockResolvedValue({ success: false, error: "invalid domain" });
		const { POST } = await import("@/app/api/dns/add-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ deployUrl: "https://alb.example.com" }),
			}) as any
		);
		expect(res.status).toBe(400);
	});
});
