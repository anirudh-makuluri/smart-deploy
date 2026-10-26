import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: {
		WORKSPACE_APPS_ENABLED: true,
		PRIVATE_APP_GATEWAY_ENABLED: true,
		PRIVATE_APP_DOCUMENTS_ENABLED: true,
		WAITING_LIST_ENABLED: false,
		GATEWAY_CODE_TTL_SECONDS: "60",
		GATEWAY_SESSION_TTL_SECONDS: "900",
	},
	authenticate: vi.fn(),
	authorize: vi.fn(),
	execute: vi.fn(),
	approved: vi.fn(),
	invited: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => ({}) }));
vi.mock("@/lib/apps/gatewayServiceAuth", () => ({ authenticateGateway: mocks.authenticate }));
vi.mock("@/lib/apps/gatewayAuthStore", () => ({
	GatewayAuthStore: class {
		authorizeDocuments = mocks.authorize;
		isInvitedMember = mocks.invited;
	},
}));
vi.mock("@/lib/apps/pilotDocumentBackend", () => ({ executePilotDocument: mocks.execute }));
import { POST } from "@/app/api/gateway/documents/route";
import { AppDataError } from "@/lib/apps/documentSchema";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

const appId = "11111111-1111-4111-8111-111111111111";
const token = "t".repeat(43);
const scope = { appId, environment: "published" };
const operation = { action: "get", collection: "notes", id: "shared" };
const browserContexts: Record<string, string>[] = [
	{ cookie: "platform=fixture" },
	{ origin: "https://control.test" },
	{ "sec-fetch-site": "same-origin" },
];
function request(
	body: unknown = { ...operation, token },
	headers: Record<string, string> = {},
	signal: AbortSignal | undefined = undefined,
) {
	return new Request("https://control.test/api/gateway/documents", {
		method: "POST",
		signal,
		headers: {
			"content-type": "application/json",
			authorization: "Bearer fixture-machine-key",
			"x-smartdeploy-binding-id": "binding",
			...headers,
		},
		body: JSON.stringify(body),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mocks.config, {
		WORKSPACE_APPS_ENABLED: true,
		PRIVATE_APP_GATEWAY_ENABLED: true,
		PRIVATE_APP_DOCUMENTS_ENABLED: true,
		WAITING_LIST_ENABLED: false,
	});
	mocks.authenticate.mockResolvedValue({ bindingId: "binding" });
	mocks.authorize.mockResolvedValue({ identity: { id: "member", email: "member@example.test" }, scope });
	mocks.execute.mockResolvedValue({ document: null });
	mocks.approved.mockResolvedValue({ approved: true });
	mocks.invited.mockResolvedValue(false);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("machine-only current-authorized app documents", () => {
	it("uses only the scope returned by the current managed-session authorization", async () => {
		const response = await POST(request());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ document: null });
		expect(mocks.authorize).toHaveBeenCalledWith("binding", token);
		expect(mocks.execute).toHaveBeenCalledWith(scope, operation, expect.any(AbortSignal));
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
	it.each(["appId", "environment", "table", "userId"])(
		"rejects a caller-provided %s override before authorization or storage",
		async (field) => {
			expect((await POST(request({ ...operation, token, [field]: "override" }))).status).toBe(400);
			expect(mocks.authorize).not.toHaveBeenCalled();
			expect(mocks.execute).not.toHaveBeenCalled();
		},
	);
	it.each(browserContexts)("rejects browser credentials/context before storage (%j)", async (headers) => {
		expect((await POST(request(undefined, headers))).status).toBe(403);
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("requires the live machine credential and the matching binding assertion", async () => {
		expect((await POST(request(undefined, { "x-smartdeploy-binding-id": "other" }))).status).toBe(403);
		mocks.authenticate.mockRejectedValue(new WorkspaceError(401, "Gateway authentication required."));
		expect((await POST(request())).status).toBe(401);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("denies revoked, expired, cross-binding or otherwise unavailable sessions", async () => {
		mocks.authorize.mockResolvedValue(null);
		expect((await POST(request())).status).toBe(403);
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("preserves the invited-member waiting-list exception without allowing unapproved managers", async () => {
		mocks.config.WAITING_LIST_ENABLED = true;
		mocks.approved.mockResolvedValue({ approved: false });
		expect((await POST(request())).status).toBe(403);
		mocks.invited.mockResolvedValue(true);
		expect((await POST(request())).status).toBe(200);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
	});
	it.each([400, 404, 409, 410, 429, 503])("returns a redacted storage failure (%s)", async (status) => {
		mocks.execute.mockRejectedValue(new AppDataError(status));
		const response = await POST(request());
		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ error: "App data operation unavailable." });
	});
	it("bounds actual body bytes and requires an explicit version on writes", async () => {
		expect(
			(await POST(request({ action: "put", token, collection: "notes", id: "shared", json: "{}" }))).status,
		).toBe(400);
		expect((await POST(request("x".repeat(32769)))).status).toBe(413);
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("does not start auth/storage when disabled or already aborted", async () => {
		mocks.config.PRIVATE_APP_DOCUMENTS_ENABLED = false;
		expect((await POST(request())).status).toBe(503);
		mocks.config.PRIVATE_APP_DOCUMENTS_ENABLED = true;
		expect((await POST(request(undefined, {}, AbortSignal.abort()))).status).toBe(503);
		expect(mocks.authenticate).not.toHaveBeenCalled();
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("ends the HTTP request at its deadline and aborts pending storage work", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		let finish: () => void = () => {};
		mocks.execute.mockImplementation((_scope: unknown, _operation: unknown, value: AbortSignal) => {
			signal = value;
			return new Promise((resolve) => {
				finish = () => resolve({ document: null });
			});
		});
		const result = POST(request());
		await vi.advanceTimersByTimeAsync(1);
		expect(signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(4000);
		expect((await result).status).toBe(503);
		expect(signal?.aborted).toBe(true);
		finish();
	});
	it("does not start document authorization or storage after a delayed machine-auth reply", async () => {
		vi.useFakeTimers();
		let finish: () => void = () => {};
		mocks.authenticate.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ bindingId: "binding" });
				}),
		);
		const result = POST(request());
		await vi.advanceTimersByTimeAsync(4001);
		expect((await result).status).toBe(503);
		finish();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.execute).not.toHaveBeenCalled();
	});
});
