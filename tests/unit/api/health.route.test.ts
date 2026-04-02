import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
	getSupabaseServer: () => getSupabaseServerMock(),
}));

describe("GET /api/health", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSupabaseServerMock.mockReturnValue({
			from: () => ({
				select: () => ({
					limit: () => ({
						maybeSingle: () => maybeSingleMock(),
					}),
				}),
			}),
		});
	});

	it("returns healthy with connected database when query succeeds", async () => {
		maybeSingleMock.mockResolvedValue({ data: null });
		const { GET } = await import("@/app/api/health/route");
		const res = await GET({} as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.status).toBe("healthy");
		expect(body.database).toBe("connected");
	});

	it("returns healthy with disconnected database when db call throws", async () => {
		getSupabaseServerMock.mockImplementation(() => {
			throw new Error("db down");
		});
		const { GET } = await import("@/app/api/health/route");
		const res = await GET({} as any);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.database).toBe("disconnected");
	});
});
