import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardSideBar from "@/components/DashboardSideBar";

const mockUseSession = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("next-auth/react", () => ({
	useSession: () => mockUseSession(),
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: () => appState,
}));

describe("DashboardSideBar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({
			data: { user: { name: "Anirudh" } },
		});
		appState = {
			repoList: [{ id: 1 }, { id: 2 }, { id: 3 }],
			deployments: [
				{ status: "running" },
				{ status: "failed" },
				{ status: "didnt_deploy" },
				{ status: "paused" },
			],
		};
	});

	it("renders navigation and workspace stats", () => {
		render(<DashboardSideBar activeView="overview" onViewChange={vi.fn()} />);

		expect(screen.getByText("Deployments")).toBeInTheDocument();
		expect(screen.getByText("History")).toBeInTheDocument();
		expect(screen.getByText("Repositories")).toBeInTheDocument();
		expect(screen.getByText("Workspace Stats")).toBeInTheDocument();
		expect(screen.getByText("Repos")).toBeInTheDocument();
		expect(screen.getByText("Active")).toBeInTheDocument();
		expect(screen.getByText("Issues")).toBeInTheDocument();

		// repos + active both evaluate to 3 for this fixture
		expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2);
		// issues = failed + paused
		expect(screen.getByText("2")).toBeInTheDocument();
	});

	it("calls onViewChange when nav buttons are clicked", () => {
		const onViewChange = vi.fn();
		const { container } = render(<DashboardSideBar activeView="overview" onViewChange={onViewChange} />);
		const aside = container.querySelector("aside");
		if (!aside) throw new Error("Sidebar not rendered");

		fireEvent.click(within(aside).getByRole("button", { name: "Deployments" }));
		fireEvent.click(within(aside).getByRole("button", { name: "History" }));
		fireEvent.click(within(aside).getByRole("button", { name: "Repositories" }));

		expect(onViewChange).toHaveBeenCalledWith("overview");
		expect(onViewChange).toHaveBeenCalledWith("deployments");
		expect(onViewChange).toHaveBeenCalledWith("repositories");
	});
});
