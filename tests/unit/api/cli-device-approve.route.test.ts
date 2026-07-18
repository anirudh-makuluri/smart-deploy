import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const isApprovedUserMock = vi.fn();
const approveDeviceAuthorizationMock = vi.fn();
const mockConfig = { WAITING_LIST_ENABLED: true };

vi.mock("@/config", () => ({
	default: mockConfig,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => getSessionMock(...args),
		},
	},
}));

vi.mock("@/db-helper", () => ({
	dbHelper: {
		isApprovedUser: (...args: unknown[]) => isApprovedUserMock(...args),
	},
}));

vi.mock("@/lib/cliAuth", () => ({
	approveDeviceAuthorization: (...args: unknown[]) => approveDeviceAuthorizationMock(...args),
}));

function makeRequest(body: unknown): Request {
	return new Request("http://localhost/api/cli/device/approve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/cli/device/approve", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.WAITING_LIST_ENABLED = true;
	});

	it("returns 401 when unauthenticated", async () => {
		getSessionMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/cli/device/approve/route");
		const response = await POST(makeRequest({ code: "approval-code" }));

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized" });
		expect(isApprovedUserMock).not.toHaveBeenCalled();
		expect(approveDeviceAuthorizationMock).not.toHaveBeenCalled();
	});

	it("rejects signed-in users who are not on the approved_users allowlist", async () => {
		getSessionMock.mockResolvedValue({
			user: { id: "user-1", email: "waitlisted@example.com" },
		});
		isApprovedUserMock.mockResolvedValue({ approved: false });

		const { POST } = await import("@/app/api/cli/device/approve/route");
		const response = await POST(makeRequest({ code: "approval-code" }));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Your account is not approved for CLI access yet.",
		});
		expect(isApprovedUserMock).toHaveBeenCalledWith("waitlisted@example.com");
		expect(approveDeviceAuthorizationMock).not.toHaveBeenCalled();
	});

	it("approves when the session user is on the allowlist", async () => {
		getSessionMock.mockResolvedValue({
			user: { id: "user-1", email: "approved@example.com" },
		});
		isApprovedUserMock.mockResolvedValue({ approved: true });
		approveDeviceAuthorizationMock.mockResolvedValue("approved");

		const { POST } = await import("@/app/api/cli/device/approve/route");
		const response = await POST(makeRequest({ code: "approval-code" }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(approveDeviceAuthorizationMock).toHaveBeenCalledWith("approval-code", "user-1");
	});

	it("skips the allowlist check when the waiting list is disabled", async () => {
		mockConfig.WAITING_LIST_ENABLED = false;
		getSessionMock.mockResolvedValue({
			user: { id: "user-1", email: "anyone@example.com" },
		});
		approveDeviceAuthorizationMock.mockResolvedValue("approved");

		const { POST } = await import("@/app/api/cli/device/approve/route");
		const response = await POST(makeRequest({ code: "approval-code" }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(isApprovedUserMock).not.toHaveBeenCalled();
		expect(approveDeviceAuthorizationMock).toHaveBeenCalledWith("approval-code", "user-1");
	});
});
