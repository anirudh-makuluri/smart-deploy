import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RepoRecordIcon from "@/components/RepoRecordIcon";

afterEach(() => {
	cleanup();
});

describe("RepoRecordIcon", () => {
	it("prefers the framework icon over the service type icon", () => {
		render(<RepoRecordIcon deployMode="container" framework="nestjs" serviceType="vite" />);

		expect(screen.getByLabelText("NestJS")).toBeInTheDocument();
		expect(screen.queryByLabelText("Vite")).not.toBeInTheDocument();
	});

	it("uses the service type icon when no framework is present", () => {
		render(<RepoRecordIcon deployMode="container" serviceType="vite" />);

		expect(screen.getByLabelText("Vite")).toBeInTheDocument();
	});

	it("falls back to a two-letter label when the chosen framework has no mapped icon", () => {
		render(<RepoRecordIcon deployMode="container" framework="foobar" serviceType="vite" />);

		expect(screen.getByLabelText("Foobar")).toHaveTextContent("FO");
		expect(screen.queryByLabelText("Vite")).not.toBeInTheDocument();
	});

	it("falls back to the container box when neither framework nor service type is present", () => {
		render(<RepoRecordIcon deployMode="container" />);

		expect(screen.getByLabelText("Container deployment")).toBeInTheDocument();
	});
});
