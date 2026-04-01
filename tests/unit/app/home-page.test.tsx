import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/home/page";

const mockUseAppDataQuery = vi.fn();

let appState: Record<string, unknown> = {};

vi.mock("@/hooks/useAppDataQuery", () => ({
	useAppDataQuery: () => mockUseAppDataQuery(),
}));

vi.mock("@/store/useAppData", () => ({
	useAppData: () => appState,
}));

vi.mock("@/components/Header", () => ({
	default: () => <div>Header</div>,
}));

vi.mock("@/components/DashboardSideBar", () => ({
	default: ({ activeView }: { activeView: string }) => <div>Sidebar:{activeView}</div>,
}));

vi.mock("@/components/DashboardMain", () => ({
	default: ({ activeView }: { activeView: string }) => <div>Main:{activeView}</div>,
}));

describe("HomePage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appState = {
			deployments: [{ status: "running" }],
			isLoading: false,
			setActiveServiceName: vi.fn(),
		};
	});

	it("keeps deployments selected when deployments exist", () => {
		render(<HomePage />);

		expect(screen.getByText("Sidebar:overview")).toBeInTheDocument();
		expect(screen.getByText("Main:overview")).toBeInTheDocument();
	});

	it("switches to repositories when no deployments are available", () => {
		appState = {
			deployments: [],
			isLoading: false,
			setActiveServiceName: vi.fn(),
		};

		render(<HomePage />);

		expect(screen.getByText("Sidebar:repositories")).toBeInTheDocument();
		expect(screen.getByText("Main:repositories")).toBeInTheDocument();
	});

	it("does not switch to repositories after the initial view has been resolved", () => {
		const { rerender } = render(<HomePage />);

		expect(screen.getByText("Sidebar:overview")).toBeInTheDocument();
		expect(screen.getByText("Main:overview")).toBeInTheDocument();

		appState = {
			deployments: [],
			isLoading: false,
			setActiveServiceName: vi.fn(),
		};

		rerender(<HomePage />);

		expect(screen.getByText("Sidebar:overview")).toBeInTheDocument();
		expect(screen.getByText("Main:overview")).toBeInTheDocument();
	});
});
