import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	authenticateCliAccessToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("@/lib/cliAuth", () => ({
	getCliBearerToken: (headers: Headers) => {
		const value = headers.get("authorization") ?? "";
		return value.startsWith("Bearer ") ? value.slice(7) : null;
	},
	authenticateCliAccessToken: mocks.authenticateCliAccessToken,
}));

import { getRequestUserId } from "@/lib/requestUser";

describe("getRequestUserId", () => {
	beforeEach(() => {
		mocks.getSession.mockReset();
		mocks.authenticateCliAccessToken.mockReset();
	});

	it("prefers an authenticated browser session", async () => {
		mocks.getSession.mockResolvedValue({ user: { id: "browser-user" } });

		await expect(getRequestUserId(new Headers())).resolves.toBe("browser-user");
		expect(mocks.authenticateCliAccessToken).not.toHaveBeenCalled();
	});

	it("authenticates a CLI bearer token when no browser session exists", async () => {
		mocks.getSession.mockResolvedValue(null);
		mocks.authenticateCliAccessToken.mockResolvedValue("cli-user");

		await expect(getRequestUserId(new Headers({ Authorization: "Bearer sd_cli_token" }))).resolves.toBe("cli-user");
		expect(mocks.authenticateCliAccessToken).toHaveBeenCalledWith("sd_cli_token");
	});

	it("returns null for an unauthenticated request", async () => {
		mocks.getSession.mockResolvedValue(null);

		await expect(getRequestUserId(new Headers())).resolves.toBeNull();
	});
});
