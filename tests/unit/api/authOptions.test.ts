import { beforeEach, describe, expect, it, vi } from "vitest";

const isApprovedUserMock = vi.fn();
const addToWaitingListMock = vi.fn();

vi.mock("@/db-helper", () => ({
	dbHelper: {
		isApprovedUser: (...args: unknown[]) => isApprovedUserMock(...args),
		addToWaitingList: (...args: unknown[]) => addToWaitingListMock(...args),
	},
}));

describe("authOptions signIn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("allows approved users to sign in", async () => {
		isApprovedUserMock.mockResolvedValue({ approved: true });

		const { authOptions } = await import("@/app/api/auth/authOptions");
		const result = await authOptions.callbacks?.signIn?.({
			user: { email: "approved@example.com", name: "Approved User" },
			account: undefined,
			profile: undefined,
			email: undefined,
			credentials: undefined,
		} as never);

		expect(result).toBe(true);
		expect(isApprovedUserMock).toHaveBeenCalledWith("approved@example.com");
		expect(addToWaitingListMock).not.toHaveBeenCalled();
	});

	it("adds unapproved users to the waiting list and denies sign in", async () => {
		isApprovedUserMock.mockResolvedValue({ approved: false });
		addToWaitingListMock.mockResolvedValue({});

		const { authOptions } = await import("@/app/api/auth/authOptions");
		const result = await authOptions.callbacks?.signIn?.({
			user: { email: "pending@example.com", name: "Pending User" },
			account: undefined,
			profile: undefined,
			email: undefined,
			credentials: undefined,
		} as never);

		expect(result).toBe(false);
		expect(isApprovedUserMock).toHaveBeenCalledWith("pending@example.com");
		expect(addToWaitingListMock).toHaveBeenCalledWith("pending@example.com", "Pending User");
	});
});
