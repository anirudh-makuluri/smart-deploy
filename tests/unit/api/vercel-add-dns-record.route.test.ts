import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const addVercelDnsRecordMock = vi.fn();

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/lib/vercelDns", () => ({
	addVercelDnsRecord: (...args: unknown[]) => addVercelDnsRecordMock(...args),
}));

describe("POST /api/vercel/add-dns-record", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when user is unauthorized", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(401);
	});

	it("returns 400 when deployUrl is missing", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(400);
	});

	it("returns custom URL on success", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		addVercelDnsRecordMock.mockResolvedValue({ success: true, customUrl: "app.example.com" });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ liveUrl: "https://foo.vercel.app", serviceName: "web" }),
			}) as any
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, customUrl: "app.example.com" });
	});

	it("returns 400 when dns helper fails", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		addVercelDnsRecordMock.mockResolvedValue({ success: false, error: "invalid domain" });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ liveUrl: "https://foo.vercel.app" }),
			}) as any
		);
		expect(res.status).toBe(400);
	});
});
