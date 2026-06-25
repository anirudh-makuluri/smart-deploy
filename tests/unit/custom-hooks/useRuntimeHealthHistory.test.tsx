import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useRuntimeHealthHistory } from "@/custom-hooks/useRuntimeHealthHistory";

function RuntimeHealthHistoryProbe(props: {
	repoName: string | undefined;
	serviceName: string | undefined;
}) {
	const { entries, isLoading } = useRuntimeHealthHistory(props);

	return (
		<div>
			<span data-testid="entries">{entries.length}</span>
			<span data-testid="is-loading">{String(isLoading)}</span>
		</div>
	);
}

function renderWithQueryClient(ui: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});

	return render(
		<QueryClientProvider client={queryClient}>
			{ui}
		</QueryClientProvider>
	);
}

describe("useRuntimeHealthHistory", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("returns an idle empty state when the runtime target is missing", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		renderWithQueryClient(<RuntimeHealthHistoryProbe repoName={undefined} serviceName="web" />);

		expect(screen.getByTestId("entries")).toHaveTextContent("0");
		expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("loads runtime health entries for a valid runtime target", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({
				entries: [
					{
						checkedAt: "2026-06-25T00:00:00.000Z",
						app: {
							checkedUrl: "https://web.example.com/health",
							httpStatus: 200,
							latencyMs: 98,
							probeResults: [true],
							overallStatus: "healthy",
						},
						ecs: null,
						alb: null,
					},
				],
			}),
		} as Response);

		renderWithQueryClient(<RuntimeHealthHistoryProbe repoName="smart-deploy" serviceName="web" />);

		await waitFor(() => {
			expect(screen.getByTestId("entries")).toHaveTextContent("1");
		});
		expect(screen.getByTestId("is-loading")).toHaveTextContent("false");
	});
});
