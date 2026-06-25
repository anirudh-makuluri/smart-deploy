import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LanguageIcon from "@/components/LanguageIcon";

afterEach(() => {
	cleanup();
});

describe("LanguageIcon", () => {
	it("renders a brand icon for mapped languages", () => {
		render(<LanguageIcon language="TypeScript" />);

		expect(screen.getByLabelText("TypeScript")).toBeInTheDocument();
	});

	it("renders a two-letter fallback for unknown languages", () => {
		render(<LanguageIcon language="Elixir" />);

		expect(screen.getByLabelText("Elixir")).toHaveTextContent("EL");
	});

	it("falls back to the GitHub icon when language is missing", () => {
		const { container } = render(<LanguageIcon language={null} />);

		expect(container.querySelector("svg")).toBeTruthy();
		expect(screen.queryByLabelText("Repository")).not.toBeInTheDocument();
	});
});
