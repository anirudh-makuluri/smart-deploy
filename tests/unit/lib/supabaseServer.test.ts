import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
	createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe("getSupabaseServer", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("throws when supabase env config is missing", async () => {
		vi.doMock("@/config", () => ({
			default: {
				SUPABASE_URL: "",
				SUPABASE_SERVICE_ROLE_KEY: "",
			},
		}));

		const mod = await import("@/lib/supabaseServer");
		expect(() => mod.getSupabaseServer()).toThrow(
			"SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment"
		);
	});

	it("creates and memoizes a supabase client", async () => {
		const fakeClient = { from: vi.fn() };
		createClientMock.mockReturnValue(fakeClient);

		vi.doMock("@/config", () => ({
			default: {
				SUPABASE_URL: "https://supabase.example.com",
				SUPABASE_SERVICE_ROLE_KEY: "service-role",
			},
		}));

		const mod = await import("@/lib/supabaseServer");
		const first = mod.getSupabaseServer();
		const second = mod.getSupabaseServer();

		expect(first).toBe(fakeClient);
		expect(second).toBe(fakeClient);
		expect(createClientMock).toHaveBeenCalledTimes(1);
	});
});
