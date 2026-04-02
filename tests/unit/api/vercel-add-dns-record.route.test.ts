import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const addVercelDnsRecordMock = vi.fn();

vi.mock("next-auth", () => ({
	getServerSession: () => getServerSessionMock(),
}));

vi.mock("@/lib/vercelDns", () => ({
	addVercelDnsRecord: (...args: unknown[]) => addVercelDnsRecordMock(...args),
}));

describe("POST /api/vercel/add-dns-record", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when user is unauthorized", async () => {
		getServerSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(401);
	});

	it("returns 400 when deployUrl is missing", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(new Request("http://localhost", { method: "POST", body: "{}" }) as any);
		expect(res.status).toBe(400);
	});

	it("returns custom URL on success", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		addVercelDnsRecordMock.mockResolvedValue({ success: true, customUrl: "app.example.com" });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ deployUrl: "https://foo.vercel.app", service_name: "web" }),
			}) as any
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, customUrl: "app.example.com" });
	});

	it("returns 400 when dns helper fails", async () => {
		getServerSessionMock.mockResolvedValue({ accessToken: "t" });
		addVercelDnsRecordMock.mockResolvedValue({ success: false, error: "invalid domain" });
		const { POST } = await import("@/app/api/vercel/add-dns-record/route");
		const res = await POST(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({ deployUrl: "https://foo.vercel.app" }),
			}) as any
		);
		expect(res.status).toBe(400);
	});
});
