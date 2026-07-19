import { describe, expect, it } from "vitest";
import { createWorkerHealthPayload, getWorkerVersion } from "@/lib/workerHealth";

describe("worker health payload", () => {
	it("reports the immutable worker image tag as the health version", () => {
		const version = getWorkerVersion("20260719-201159-96c75f1");

		expect(
			createWorkerHealthPayload({
				port: 4001,
				environment: "production",
				version,
			})
		).toEqual({
			ok: true,
			service: "websocket",
			port: 4001,
			environment: "production",
			version: "20260719-201159-96c75f1",
		});
	});

	it("uses a development marker when no image version is available", () => {
		expect(getWorkerVersion(undefined)).toBe("development");
		expect(getWorkerVersion("   ")).toBe("development");
	});
});
