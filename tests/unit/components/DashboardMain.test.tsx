import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardMain from "@/components/DashboardMain";

const mockUseSession = vi.fn();
const mockPush = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => mockUseSession(),
	},
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

vi.mock("next/link", () => ({
	default: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe("DashboardMain", () => {
	afterEach(() => {
		cleanup();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockUseSession.mockReturnValue({
			data: { user: { name: "Anirudh" } },
		});
		appState = {
			deployments: [
				{ status: "running", repoUrl: "https://github.com/acme/repo-one" },
				{ status: "failed", repoUrl: "https://github.com/acme/repo-two" },
			],
			repoRecords: [
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
		expect(screen.getAllByText("repo-one").length).toBeGreaterThan(0);
	});

	it("renders history view table", () => {
		render(<DashboardMain activeView="history" />);

		expect(screen.getAllByRole("heading", { name: "History" }).length).toBeGreaterThan(0);
		expect(screen.getAllByText("DeploymentHistoryTable").length).toBeGreaterThan(0);
	});

	it("renders repositories view with add and refresh controls", () => {
		render(<DashboardMain activeView="repositories" />);

		expect(screen.getAllByRole("heading", { name: "Repositories" }).length).toBeGreaterThan(0);
		expect(screen.getAllByRole("link", { name: /set up auto-deploy/i })[0]).toHaveAttribute("href", "/api/github/install");
		expect(screen.getAllByRole("button", { name: "Refresh" }).length).toBeGreaterThan(0);
		expect(screen.getAllByTitle("Add public repository").length).toBeGreaterThan(0);
		expect(screen.getAllByText("repo-one").length).toBeGreaterThan(0);
	});
});
