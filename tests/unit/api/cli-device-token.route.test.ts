import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("@/lib/cliAuth", () => ({ consumeDeviceAuthorization: mocks.consume }));
import { POST } from "@/app/api/cli/device/token/route";
import { PlatformAccessError } from "@/lib/platformAccess";

function request(body: unknown): Request {
	return new Request("https://control.test/api/cli/device/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { mocks.consume.mockReset(); });

describe("CLI device credential redemption", () => {
	it.each([null, [], {}, { deviceCode: 42 }])("rejects malformed bodies without redeeming a credential", async (body) => {
		expect((await POST(request(body))).status).toBe(400);
		expect(mocks.consume).not.toHaveBeenCalled();
	});
	it("keeps pending and issued credentials out of caches", async () => {
		mocks.consume.mockResolvedValueOnce(null).mockResolvedValueOnce({ token: "sd_cli_local_only", userId: "actor" });
		const pending = await POST(request({ deviceCode: "local-code" }));
		expect(pending.status).toBe(202);
		expect(pending.headers.get("cache-control")).toBe("no-store");
		const issued = await POST(request({ deviceCode: "local-code" }));
		expect(issued.status).toBe(200);
		expect(issued.headers.get("cache-control")).toBe("no-store");
		expect(await issued.json()).toEqual({ accessToken: "sd_cli_local_only", tokenType: "Bearer" });
	});
	it("reports verification denial without returning an access token", async () => {
		mocks.consume.mockRejectedValue(new PlatformAccessError(403, "Verify your email before managing deployments."));
		const response = await POST(request({ deviceCode: "local-code" }));
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Verify your email before managing deployments." });
	});
	it("redacts unexpected backend failures", async () => {
		mocks.consume.mockRejectedValue(new Error("private-database-details"));
		const response = await POST(request({ deviceCode: "local-code" }));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("private-database-details");
	});
});
