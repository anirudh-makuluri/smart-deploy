import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HeaderMobileDock from "@/components/header/HeaderMobileDock";

describe("HeaderMobileDock", () => {
	it("opens the agent and menu actions", () => {
		const onOpenHelpAgent = vi.fn();
		const onOpenMobileNavMenu = vi.fn();

		render(
			<HeaderMobileDock
				onOpenHelpAgent={onOpenHelpAgent}
				onOpenMobileNavMenu={onOpenMobileNavMenu}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /open agent/i }));
		fireEvent.click(screen.getByRole("button", { name: /open menu/i }));

		expect(onOpenHelpAgent).toHaveBeenCalledTimes(1);
		expect(onOpenMobileNavMenu).toHaveBeenCalledTimes(1);
		expect(screen.getByText("Agent")).toBeInTheDocument();
		expect(screen.getByText("Menu")).toBeInTheDocument();
	});
});
