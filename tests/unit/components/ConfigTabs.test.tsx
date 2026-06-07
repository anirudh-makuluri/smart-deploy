import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfigTabs from "@/components/ConfigTabs";
import { makeDeployment } from "../helpers/deployConfigFixture";

const mockUpdateCustomDomain = vi.fn();

vi.mock("@/store/useAppData", () => ({
	useAppData: (selector: (state: { updateDeploymentById: ReturnType<typeof vi.fn> }) => unknown) =>
		selector({ updateDeploymentById: vi.fn() }),
}));

vi.mock("@/lib/graphqlClient", () => ({
	updateCustomDomain: (...args: unknown[]) => mockUpdateCustomDomain(...args),
}));

vi.mock("@/components/EnvVarSheet", () => ({
	default: () => <div data-testid="env-sheet" />,
}));

vi.mock("@/config.client", () => ({
	default: {
		NEXT_PUBLIC_DEPLOYMENT_DOMAIN: "smart-deploy.xyz",
	},
}));

vi.mock("@/lib/aws/ec2InstanceTypes", () => ({
	DEFAULT_EC2_INSTANCE_TYPE: "t3.micro",
	EC2_INSTANCE_TYPE_PRESETS: ["t3.micro"],
	formatApproxEc2PriceCompact: vi.fn(() => "$0.0104/hr"),
}));

vi.mock("@/custom-hooks/useDeploymentEnvSecrets", () => ({
	useDeploymentEnvSecrets: () => ({
		entries: [{ name: "", value: "" }],
		envVarsString: "",
		isLoading: false,
		isSaving: false,
		handleEntriesChange: vi.fn(),
		saveEnvString: vi.fn(),
	}),
}));

describe("ConfigTabs", () => {
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
