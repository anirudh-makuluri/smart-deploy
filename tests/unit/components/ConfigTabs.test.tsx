import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConfigTabs from "@/components/ConfigTabs";
import { makeDeployment } from "../helpers/deployConfigFixture";

const mockUpdateCustomDomain = vi.fn();
const mockEnvSecrets = { entries: [{ name: "TOKEN", value: "first-secret" }] };

vi.mock("@/store/useAppData", () => ({
	useAppData: (selector: (state: { updateDeploymentById: ReturnType<typeof vi.fn> }) => unknown) =>
		selector({ updateDeploymentById: vi.fn() }),
}));

vi.mock("@/lib/graphqlClient", () => ({
	updateCustomDomain: (...args: unknown[]) => mockUpdateCustomDomain(...args),
}));

vi.mock("@/config.client", () => ({
	default: {
		NEXT_PUBLIC_DEPLOYMENT_DOMAIN: "smart-deploy.xyz",
	},
}));

vi.mock("@/custom-hooks/useDeploymentEnvSecrets", () => ({
	useDeploymentEnvSecrets: () => ({
		entries: mockEnvSecrets.entries,
		envVarsString: "",
		isLoading: false,
		isSaving: false,
		handleEntriesChange: vi.fn(),
		saveEnvString: vi.fn(),
	}),
}));

describe("ConfigTabs", () => {
	beforeEach(() => { mockEnvSecrets.entries = [{ name: "TOKEN", value: "first-secret" }]; });
	it("resets the secret editor when the selected deployment changes", () => {
		const first = makeDeployment({ id: "first", serviceName: "web" });
		const second = makeDeployment({ id: "second", serviceName: "api" });
		const props = { repoFullName: "acme/repo", branches: ["main"], onConfigChange: vi.fn() };
		const view = render(<ConfigTabs {...props} deployment={first} />);
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		const original = screen.getByLabelText("Variable 1 value");
		fireEvent.focus(original);
		expect(original).toHaveAttribute("type", "text");
		mockEnvSecrets.entries = [{ name: "TOKEN", value: "second-secret" }];
		view.rerender(<ConfigTabs {...props} deployment={second} />);
		const replacement = screen.getByLabelText("Variable 1 value");
		expect(replacement).not.toBe(original);
		expect(replacement).toHaveAttribute("type", "password");
		expect(replacement).toHaveValue("second-secret");
	});
	it("allows saving a custom domain for a draft deployment", async () => {
		mockUpdateCustomDomain.mockResolvedValue({ message: "Custom domain saved" });

		render(
			<ConfigTabs
				deployment={makeDeployment({
					id: "persisted-row",
					repoName: "repo",
					repoUrl: "https://github.com/acme/repo",
					serviceName: "web",
					status: "didnt_deploy",
				})}
				repoFullName="acme/repo"
				branches={["main"]}
				onConfigChange={vi.fn()}
			/>
		);

		fireEvent.change(screen.getByPlaceholderText("my-cool-app"), {
			target: { value: "preview" },
		});

		const saveButton = screen.getByRole("button", { name: "Save" });
		expect(saveButton).toBeEnabled();

		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(mockUpdateCustomDomain).toHaveBeenCalledWith(
				"repo",
				"web",
				"https://preview.smart-deploy.xyz"
			);
		});
	});
});
