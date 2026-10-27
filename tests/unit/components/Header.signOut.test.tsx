import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "@/components/Header";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), toastError: vi.fn(), router: { replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: mocks.signOut, useSession: () => ({ data: null }) } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useParams: () => ({}), usePathname: () => "/home" }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/components/header/useHeaderSystemHealth", () => ({ useHeaderSystemHealth: () => ({}) }));
vi.mock("@/components/header/HeaderActions", () => ({ default: ({ onSignOut }: { onSignOut: () => Promise<void> }) => <button onClick={onSignOut}>Sign out</button> }));
vi.mock("@/components/header/HeaderBreadcrumbs", () => ({ default: () => null }));
vi.mock("@/components/header/HeaderMobileDock", () => ({ default: () => null }));
vi.mock("@/components/DeploymentAgentSheet", () => ({ default: () => null }));
vi.mock("@/components/UserReportSheet", () => ({ default: () => null }));
vi.mock("@/components/SmartDeployLogo", () => ({ SmartDeployLogo: () => null }));

describe("header sign-out", () => {
	beforeEach(() => { vi.clearAllMocks(); });
	afterEach(cleanup);

	it("keeps the page on a failed revocation and allows a successful retry", async () => {
		mocks.signOut.mockResolvedValueOnce({ error: { status: 503 } }).mockResolvedValueOnce({ error: null });
		render(<Header />);
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
		expect(mocks.router.replace).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/auth"));
		expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
	});

	it("deduplicates clicks while sign-out is in flight and handles network rejection", async () => {
		let rejectSignOut: (reason: Error) => void = () => { throw new Error("No request"); };
		mocks.signOut.mockReturnValue(new Promise((_resolve, reject) => { rejectSignOut = reject; }));
		render(<Header />);
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		expect(mocks.signOut).toHaveBeenCalledTimes(1);
		rejectSignOut(new Error("Offline"));
		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		expect(mocks.router.replace).not.toHaveBeenCalled();
	});
});
