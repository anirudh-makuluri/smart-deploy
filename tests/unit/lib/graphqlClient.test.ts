import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateDeployment } from "@/lib/graphqlClient";
import { makeDeployment } from "../helpers/deployConfigFixture";

describe("graphqlClient.updateDeployment", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: {
					updateDeployment: {
						status: "success",
					},
				},
			}),
		}) as unknown as typeof fetch;
	});

	it("strips legacy fields that are not part of DeployConfigInput", async () => {
		const config = {
			...makeDeployment({
				repoName: "hoplio",
				serviceName: "web",
				secretsArn: "arn:aws:secretsmanager:us-west-2:123:secret:test",
			}),
			envVars: "SECRET=value",
			ec2: { instanceId: "i-123" },
		} as ReturnType<typeof makeDeployment> & { ec2: { instanceId: string } };

		await updateDeployment(config);

		expect(global.fetch).toHaveBeenCalledTimes(1);
		const [, requestInit] = vi.mocked(global.fetch).mock.calls[0]!;
		const body = JSON.parse(String(requestInit?.body ?? "{}")) as {
			variables?: {
				config?: Record<string, unknown>;
			};
		};

		expect(body.variables?.config).toMatchObject({
			repoName: "hoplio",
			serviceName: "web",
			secretsArn: "arn:aws:secretsmanager:us-west-2:123:secret:test",
		});
		expect(body.variables?.config).not.toHaveProperty("envVars");
		expect(body.variables?.config).not.toHaveProperty("ec2");
	});
});
