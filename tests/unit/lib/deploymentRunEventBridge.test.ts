import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function importBridge() {
	vi.resetModules();
	return import("@/lib/deploymentRunEventBridge");
}

describe("deploymentRunEventBridge", () => {
	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("derives the HTTP bridge URL from NEXT_PUBLIC_WS_URL", async () => {
		process.env.NEXT_PUBLIC_WS_URL = "wss://ws.smart-deploy.xyz/ws";
		delete process.env.DEPLOYMENT_EVENTS_URL;

		const { __testing } = await importBridge();
		expect(__testing.resolveBridgeBaseUrl()).toBe("https://ws.smart-deploy.xyz");
	});

	it("does not create an emitter when the shared token is missing", async () => {
		process.env.NEXT_PUBLIC_WS_URL = "wss://ws.smart-deploy.xyz/ws";
		delete process.env.DEPLOYMENT_EVENTS_TOKEN;
		delete process.env.INTERNAL_DEPLOYMENT_EVENTS_TOKEN;

		const { createDeploymentRunEventBridge } = await importBridge();
		expect(createDeploymentRunEventBridge("run-1")).toBeNull();
	});
});

