import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GithubAppSetupBanner from "@/components/dashboard/GithubAppSetupBanner";

const useSessionMock = vi.fn();

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => useSessionMock(),
	},
}));

vi.mock("next/link", () => ({
	default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
		<a href={href} {...props}>{children}</a>
	),
}));

function renderBanner() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<GithubAppSetupBanner />
		</QueryClientProvider>
	);
}

describe("GithubAppSetupBanner", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		useSessionMock.mockReturnValue({
			data: { user: { id: "user-1" } },
			isPending: false,
		});
	});

	it("shows the setup banner when the app is not installed", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ installed: false }))));
		renderBanner();

		await waitFor(() => {
			expect(screen.getByLabelText("Set up GitHub auto-deploy")).toBeInTheDocument();
		});
		expect(screen.getByRole("link", { name: /choose repositories/i })).toHaveAttribute("href", "/api/github/install");
	});

	it("hides the banner when an installation is accessible", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ installed: true }))));
		renderBanner();

		await waitFor(() => {
			expect(fetch).toHaveBeenCalledWith("/api/github/installations/status");
		});
		expect(screen.queryByLabelText("Set up GitHub auto-deploy")).not.toBeInTheDocument();
	});
});
