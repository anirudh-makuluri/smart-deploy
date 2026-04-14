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

describe("GET /api/repos/services", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 for missing user", async () => {
		getSessionMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(401);
	});

	it("returns 500 when graphql operation fails", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		executeGraphQLOperationMock.mockRejectedValue(new Error("bad db"));
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(500);
	});

	it("returns services on success", async () => {
		getSessionMock.mockResolvedValue({ user: { id: "u1" } });
		executeGraphQLOperationMock.mockResolvedValue({
			repoServices: [{ repo: "acme/repo" }],
		});
		const { GET } = await import("@/app/api/repos/services/route");
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ services: [{ repo: "acme/repo" }] });
	});
});
