import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardMain from "@/components/DashboardMain";

const mockUseSession = vi.fn();
const mockPush = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("next-auth/react", () => ({
	useSession: () => mockUseSession(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		push: mockPush,
	}),
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: () => appState,
}));

vi.mock("@/components/DeploymentHistoryTable", () => ({
	default: () => <div>DeploymentHistoryTable</div>,
}));

vi.mock("@/lib/utils", async () => {
	const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
	return {
		...actual,
		formatTimestamp: vi.fn(() => "formatted-time"),
	};
});

describe("DashboardMain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({
			data: { user: { name: "Anirudh" } },
		});
		appState = {
			deployments: [
				{ status: "running", url: "https://github.com/acme/repo-one" },
				{ status: "failed", url: "https://github.com/acme/repo-two" },
			],
			repoServices: [
				{ repo_owner: "acme", repo_name: "repo-one", repo_url: "https://github.com/acme/repo-one", services: [{ name: "web", path: ".", language: "node" }] },
				{ repo_owner: "acme", repo_name: "repo-two", repo_url: "https://github.com/acme/repo-two", services: [{ name: "api", path: ".", language: "node" }] },
			],
			repoList: [
				{
					id: 1,
					full_name: "acme/repo-one",
					owner: { login: "acme" },
					name: "repo-one",
					latest_commit: { message: "feat: update", date: "2026-03-21T00:00:00.000Z" },
				},
			],
			isLoading: false,
			setAppData: vi.fn(),
			refreshRepoList: vi.fn(async () => ({ status: "success", message: "ok" })),
		};
	});

	it("renders deployments view by default", () => {
		render(<DashboardMain activeView="overview" />);

		expect(screen.getAllByRole("heading", { name: "Deployments" }).length).toBeGreaterThan(0);
		expect(screen.getByText("acme / repo-one")).toBeInTheDocument();
	});

	it("renders history view table", () => {
		render(<DashboardMain activeView="deployments" />);

		expect(screen.getAllByRole("heading", { name: "History" }).length).toBeGreaterThan(0);
		expect(screen.getAllByText("DeploymentHistoryTable").length).toBeGreaterThan(0);
	});

	it("renders repositories view with add and refresh controls", () => {
		render(<DashboardMain activeView="repositories" />);

		expect(screen.getAllByRole("heading", { name: "Repositories" }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("button", { name: "Refresh" }).length).toBeGreaterThan(0);
		expect(screen.getAllByTitle("Add public repository").length).toBeGreaterThan(0);
		expect(screen.getAllByText("acme/repo-one").length).toBeGreaterThan(0);
	});
});
