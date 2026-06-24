import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeaderActions from "@/components/header/HeaderActions";

vi.mock("next/image", () => ({
	default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

const systemHealth = {
	status: "healthy",
	message: "All systems operational",
	services: [
		{ name: "API", status: "healthy" as const },
	],
};

describe("HeaderActions", () => {
	afterEach(() => {
		cleanup();
	});

	it("moves feedback into the profile dropdown for signed-in users", async () => {
		const onOpenHelpAgent = vi.fn();
		const onOpenReport = vi.fn();
		const onSignOut = vi.fn();

		render(
			<HeaderActions
				systemHealth={systemHealth}
				session={{
					user: {
						name: "Anirudh",
						email: "anirudh@example.com",
						image: null,
					},
				}}
				onOpenHelpAgent={onOpenHelpAgent}
				onOpenReport={onOpenReport}
				onSignOut={onSignOut}
			/>
		);

		expect(screen.queryByLabelText("Report issue")).not.toBeInTheDocument();

		const profileTrigger = screen.getByRole("button", { name: /open profile menu/i });
		fireEvent.pointerDown(profileTrigger, { button: 0, ctrlKey: false });

		const reportItem = await screen.findByText("Report issue");
		fireEvent.click(reportItem);

		expect(onOpenReport).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: /agent/i })).toBeInTheDocument();
	});

	it("keeps feedback unavailable when no session user exists", () => {
		render(
			<HeaderActions
				systemHealth={systemHealth}
				session={null}
				onOpenHelpAgent={vi.fn()}
				onOpenReport={vi.fn()}
				onSignOut={vi.fn()}
			/>
		);

		expect(screen.queryByLabelText("Report issue")).not.toBeInTheDocument();
		expect(screen.queryByRole("menuitem", { name: /report issue/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /open profile menu/i })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: /view system health/i })).toBeInTheDocument();
	});
});
