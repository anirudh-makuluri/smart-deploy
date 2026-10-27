import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: {
		PRIVATE_APP_DOCUMENTS_ENABLED: true,
		APP_DOCUMENTS_APP_ID: "11111111-1111-4111-8111-111111111111",
		APP_DOCUMENTS_TABLE_ARN: "arn:aws:dynamodb:us-west-2:111122223333:table/pilot-documents",
		APP_DOCUMENTS_ROLE_ARN: "arn:aws:iam::111122223333:role/pilot-documents",
		AWS_REGION: "us-west-2",
	},
	configurations: [] as Record<string, unknown>[],
	destroy: vi.fn(),
	get: vi.fn(),
	put: vi.fn(),
	remove: vi.fn(),
	construct: vi.fn(),
	assume: vi.fn(),
}));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/lib/aws/sdkClients", () => ({ getAwsClientConfig: (region: string) => ({ region }) }));
vi.mock("@/lib/aws/documentRole", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/aws/documentRole")>(), assumeDocumentRole: mocks.assume }));
vi.mock("@aws-sdk/client-dynamodb", () => ({
	DynamoDBClient: class {
		constructor(configuration: Record<string, unknown>) {
			mocks.configurations.push(configuration);
		}
	},
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
	DynamoDBDocumentClient: { from: () => ({ destroy: mocks.destroy }) },
}));
vi.mock("@/lib/apps/documentStore", () => ({
	AppDocumentStore: class {
		constructor(...args: unknown[]) {
			mocks.construct(...args);
		}
		get = mocks.get;
		put = mocks.put;
		remove = mocks.remove;
	},
}));
import { executePilotDocument } from "@/lib/apps/pilotDocumentBackend";
import { AppDataError } from "@/lib/apps/documentSchema";

const scope = { appId: "11111111-1111-4111-8111-111111111111", environment: "published" as const };
const address = { ...scope, collection: "notes", id: "shared" };
const version = "22222222-2222-4222-8222-222222222222";
const get = { action: "get" as const, collection: "notes", id: "shared" };
beforeEach(() => {
	vi.clearAllMocks();
	mocks.configurations.length = 0;
	Object.assign(mocks.config, {
		PRIVATE_APP_DOCUMENTS_ENABLED: true,
		APP_DOCUMENTS_APP_ID: scope.appId,
		APP_DOCUMENTS_TABLE_ARN: "arn:aws:dynamodb:us-west-2:111122223333:table/pilot-documents",
		APP_DOCUMENTS_ROLE_ARN: "arn:aws:iam::111122223333:role/pilot-documents",
		AWS_REGION: "us-west-2",
	});
	mocks.get.mockResolvedValue(null);
	mocks.put.mockResolvedValue({ collection: "notes", id: "shared", version, json: "{}" });
	mocks.remove.mockResolvedValue(undefined);
	mocks.assume.mockResolvedValue({ accessKeyId: "ASIA" + "A".repeat(16), secretAccessKey: "s".repeat(40), sessionToken: "t".repeat(64), expiration: new Date(Date.now() + 900000) });
});
afterEach(() => vi.restoreAllMocks());

describe("bounded single-app document backend", () => {
	it("uses the explicit table ARN and AWS HTTPS endpoint with retries disabled, then destroys the client", async () => {
		const signal = new AbortController().signal;
		await expect(executePilotDocument(scope, get, signal)).resolves.toEqual({ document: null });
		expect(mocks.configurations).toEqual([
			expect.objectContaining({
				region: "us-west-2",
				credentials: expect.objectContaining({ sessionToken: "t".repeat(64) }),
				endpoint: "https://dynamodb.us-west-2.amazonaws.com",
				maxAttempts: 1,
				requestHandler: expect.objectContaining({
					connectionTimeout: 1000,
					requestTimeout: 1800,
					throwOnRequestTimeout: true,
					httpsAgent: { keepAlive: true, maxSockets: 2 },
				}),
			}),
		]);
		expect(mocks.construct).toHaveBeenCalledWith(
			expect.anything(),
			mocks.config.APP_DOCUMENTS_TABLE_ARN,
			Date.now,
			signal,
		);
		expect(mocks.get).toHaveBeenCalledWith(address);
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});
	it("rejects missing role configuration without falling back to platform DynamoDB credentials", async () => {
		mocks.config.APP_DOCUMENTS_ROLE_ARN = "";
		await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		expect(mocks.assume).not.toHaveBeenCalled(); expect(mocks.configurations).toHaveLength(0);
	});
	it("never constructs DynamoDB on credential failure and releases admission", async () => {
		mocks.assume.mockRejectedValueOnce(new AppDataError(503));
		await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		expect(mocks.configurations).toHaveLength(0);
		await expect(executePilotDocument(scope, get, new AbortController().signal)).resolves.toEqual({ document: null });
	});
	it("counts pending credential requests against both admission slots and discards late cancelled credentials", async () => {
		const releases: Array<() => void> = [];
		mocks.assume.mockImplementation(() => new Promise(resolve => releases.push(() => resolve({ accessKeyId: "test", secretAccessKey: "test", sessionToken: "test" }))));
		const controller = new AbortController(); const first = executePilotDocument(scope, get, controller.signal); const second = executePilotDocument(scope, get, controller.signal);
		const rejected = Promise.allSettled([first, second]); controller.abort();
		await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
		expect(mocks.assume).toHaveBeenCalledTimes(2); expect(mocks.configurations).toHaveLength(0);
		for (const release of releases) release(); expect((await rejected).every(result => result.status === "rejected")).toBe(true); expect(mocks.configurations).toHaveLength(0);
	});
	it("preserves preview isolation and explicit optimistic versions for mutation", async () => {
		const signal = new AbortController().signal;
		await executePilotDocument(
			{ ...scope, environment: "preview" },
			{ ...get, action: "put", json: '{ "value": 1 }', expectedVersion: null },
			signal,
		);
		expect(mocks.put).toHaveBeenCalledWith({ ...address, environment: "preview" }, '{"value":1}', null);
		await executePilotDocument(scope, { ...get, action: "remove", expectedVersion: version }, signal);
		expect(mocks.remove).toHaveBeenCalledWith(address, version);
	});
	it.each([
		"",
		"table-name-only",
		"arn:aws:dynamodb:us-east-1:111122223333:table/pilot-documents",
		"arn:aws:dynamodb:evil.example:111122223333:table/pilot-documents",
	])("fails closed on missing, mismatched or malformed table configuration (%s)", async (table) => {
		mocks.config.APP_DOCUMENTS_TABLE_ARN = table;
		await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({
			status: 503,
		});
		expect(mocks.configurations).toHaveLength(0);
	});
	it("denies disabled, non-allowlisted and already-aborted requests without constructing an SDK client", async () => {
		mocks.config.PRIVATE_APP_DOCUMENTS_ENABLED = false;
		await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({
			status: 503,
		});
		mocks.config.PRIVATE_APP_DOCUMENTS_ENABLED = true;
		await expect(
			executePilotDocument({ ...scope, appId: version }, get, new AbortController().signal),
		).rejects.toMatchObject({ status: 403 });
		await expect(executePilotDocument(scope, get, AbortSignal.abort())).rejects.toMatchObject({
			status: 503,
		});
		expect(mocks.configurations).toHaveLength(0);
	});
	it("rejects invalid document JSON before the SDK can make a request", async () => {
		await expect(
			executePilotDocument(
				scope,
				{ ...get, action: "put", json: "[]", expectedVersion: null },
				new AbortController().signal,
			),
		).rejects.toMatchObject({ status: 400 });
		expect(mocks.configurations).toHaveLength(0);
	});
	it("releases SDK resources when storage fails without retrying the mutation", async () => {
		mocks.put.mockRejectedValue(new AppDataError(503));
		await expect(
			executePilotDocument(
				scope,
				{ ...get, action: "put", json: "{}", expectedVersion: null },
				new AbortController().signal,
			),
		).rejects.toMatchObject({ status: 503 });
		expect(mocks.put).toHaveBeenCalledTimes(1);
		expect(mocks.destroy).toHaveBeenCalledTimes(1);
	});
	it("holds both admission slots until pending work actually settles, even after cancellation", async () => {
		const releases: Array<() => void> = [];
		mocks.get.mockImplementation(
			() =>
				new Promise((resolve) => {
					releases.push(() => resolve(null));
				}),
		);
		const controller = new AbortController();
		const first = executePilotDocument(scope, get, controller.signal);
		const second = executePilotDocument(scope, get, new AbortController().signal);
		try {
			await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({
				status: 503,
			});
			controller.abort();
			await expect(executePilotDocument(scope, get, new AbortController().signal)).rejects.toMatchObject({
				status: 503,
			});
			expect(mocks.configurations).toHaveLength(2);
			expect(mocks.destroy).not.toHaveBeenCalled();
		} finally {
			for (const release of releases) release();
			await Promise.all([first, second]);
		}
		expect(mocks.destroy).toHaveBeenCalledTimes(2);
		mocks.get.mockResolvedValue(null);
		await expect(executePilotDocument(scope, get, new AbortController().signal)).resolves.toEqual({
			document: null,
		});
	});
});
