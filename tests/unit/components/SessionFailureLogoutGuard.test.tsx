import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ExternalToast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionFailureLogoutGuard } from "@/components/auth/SessionFailureLogoutGuard";

const mocks = vi.hoisted(() => ({
	signOut: vi.fn(), error: { code: "FAILED_TO_GET_SESSION" } as unknown,
	router: { replace: vi.fn(), refresh: vi.fn() },
	toastError: vi.fn<(message: string, options?: ExternalToast) => number>(), dismiss: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: {
	useSession: () => ({ error: mocks.error }), signOut: mocks.signOut,
} }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, dismiss: mocks.dismiss } }));

function retryAction() {
	const action = mocks.toastError.mock.calls.at(-1)?.[1]?.action;
	if (!action || typeof action !== "object" || !("onClick" in action)) throw new Error("Retry action missing");
	return action;
}

describe("session failure recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.error = { code: "FAILED_TO_GET_SESSION" };
		mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
		mocks.toastError.mockReturnValue(42);
	});
	afterEach(cleanup);

	it("does not hide a server-side revocation failure and retries explicitly", async () => {
		mocks.signOut.mockResolvedValueOnce({ data: null, error: { status: 503 } });
		render(<SessionFailureLogoutGuard />);
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		expect(mocks.router.replace).not.toHaveBeenCalled();
		expect(mocks.router.refresh).not.toHaveBeenCalled();
		expect(retryAction().label).toBe("Retry sign-out");
		await act(async () => { retryAction().onClick({} as React.MouseEvent<HTMLButtonElement>); });
		expect(mocks.signOut).toHaveBeenCalledTimes(2);
		expect(mocks.router.replace).toHaveBeenCalledWith("/auth");
		expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
	});

	it("reports a network failure without clearing cookies or navigating", async () => {
		const cookieSetter = vi.spyOn(document, "cookie", "set");
		mocks.signOut.mockRejectedValueOnce(new Error("network unavailable"));
		render(<SessionFailureLogoutGuard />);
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		expect(mocks.router.replace).not.toHaveBeenCalled();
		expect(cookieSetter).not.toHaveBeenCalled();
		cookieSetter.mockRestore();
	});

	it("does not start overlapping requests when the retry action is clicked twice", async () => {
		mocks.signOut.mockResolvedValueOnce({ error: { status: 503 } });
		render(<SessionFailureLogoutGuard />);
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		let resolveRetry: (value: unknown) => void = () => { throw new Error("No retry"); };
		mocks.signOut.mockReturnValue(new Promise((resolve) => { resolveRetry = resolve; }));
		const action = retryAction();
		await act(async () => {
			action.onClick({} as React.MouseEvent<HTMLButtonElement>);
			action.onClick({} as React.MouseEvent<HTMLButtonElement>);
		});
		expect(mocks.signOut).toHaveBeenCalledTimes(2);
		await act(async () => { resolveRetry({ error: null }); });
		expect(mocks.router.replace).toHaveBeenCalledTimes(1);
	});

	it("deduplicates Strict Mode replay while still navigating on success", async () => {
		render(<React.StrictMode><SessionFailureLogoutGuard /></React.StrictMode>);
		await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledTimes(1));
		expect(mocks.signOut).toHaveBeenCalledTimes(1);
	});

	it("ignores non-session errors and recognizes nested SDK error codes", async () => {
		mocks.error = { code: "OTHER_ERROR" };
		const view = render(<SessionFailureLogoutGuard />);
		expect(mocks.signOut).not.toHaveBeenCalled();
		mocks.error = { error: { code: "FAILED_TO_GET_SESSION" } };
		view.rerender(<SessionFailureLogoutGuard />);
		await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/auth"));
	});

	it("ignores late completion after unmount", async () => {
		let resolveSignOut: (value: unknown) => void = () => { throw new Error("No request"); };
		mocks.signOut.mockReturnValue(new Promise((resolve) => { resolveSignOut = resolve; }));
		const view = render(<SessionFailureLogoutGuard />);
		view.unmount();
		await act(async () => { resolveSignOut({ error: null }); });
		expect(mocks.router.replace).not.toHaveBeenCalled();
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it("dismisses its retry notification and disables its stale action after unmount", async () => {
		mocks.signOut.mockResolvedValueOnce({ error: { status: 503 } });
		const view = render(<SessionFailureLogoutGuard />);
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		const action = retryAction();
		view.unmount();
		expect(mocks.dismiss).toHaveBeenCalledWith(42);
		await act(async () => { action.onClick({} as React.MouseEvent<HTMLButtonElement>); });
		expect(mocks.signOut).toHaveBeenCalledTimes(1);
	});
});
