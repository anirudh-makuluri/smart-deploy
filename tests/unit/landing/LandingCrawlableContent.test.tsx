import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingCrawlableContent } from "@/components/landing/LandingCrawlableContent";

describe("LandingCrawlableContent", () => {
	it("renders crawlable product overview for bots", () => {
		render(
			<LandingCrawlableContent
				publicStats={{ totalDeployments: 47, totalAnalyses: 130, totalArtifacts: 220 }}
			/>
		);

		expect(screen.getByTestId("landing-crawlable-content")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: /Deploy without the black box/i })).toBeInTheDocument();
		expect(screen.getByText(/130/)).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 3, name: "Smart Analysis" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Documentation/i })).toHaveAttribute("href", "/docs");
	});
});
