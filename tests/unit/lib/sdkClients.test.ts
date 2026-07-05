import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function importClientConfig() {
	vi.resetModules();
	const mod = await import("@/lib/aws/sdkClients");
	return mod.getAwsClientConfig;
}

describe("getAwsClientConfig", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		vi.resetModules();
	});

	it("uses explicit access keys outside managed AWS runtimes", async () => {
		process.env.AWS_REGION = "us-west-2";
		process.env.AWS_ACCESS_KEY_ID = "key";
		process.env.AWS_SECRET_ACCESS_KEY = "secret";

		const getAwsClientConfig = await importClientConfig();
		expect(getAwsClientConfig("us-east-1")).toEqual({
			region: "us-east-1",
			credentials: {
				accessKeyId: "key",
				secretAccessKey: "secret",
			},
		});
	});

	it("omits credentials when explicit access keys are not set", async () => {
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		process.env.AWS_REGION = "us-west-2";

		const getAwsClientConfig = await importClientConfig();
		expect(getAwsClientConfig()).toEqual({ region: "us-west-2" });
	});

	it("lets Lambda use the default credential provider chain", async () => {
		process.env.AWS_REGION = "us-west-2";
		process.env.AWS_ACCESS_KEY_ID = "lambda-runtime-key";
		process.env.AWS_SECRET_ACCESS_KEY = "lambda-runtime-secret";
		process.env.AWS_LAMBDA_FUNCTION_NAME = "smart-deploy-deployment-queue-handler";

		const getAwsClientConfig = await importClientConfig();
		expect(getAwsClientConfig()).toEqual({ region: "us-west-2" });
	});

	it("lets ECS tasks use the default credential provider chain", async () => {
		process.env.AWS_REGION = "us-west-2";
		process.env.AWS_ACCESS_KEY_ID = "ecs-runtime-key";
		process.env.AWS_SECRET_ACCESS_KEY = "ecs-runtime-secret";
		process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/v2/credentials/task";

		const getAwsClientConfig = await importClientConfig();
		expect(getAwsClientConfig()).toEqual({ region: "us-west-2" });
	});
});
