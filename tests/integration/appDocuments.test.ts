import { randomUUID } from "node:crypto";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDocumentStore } from "../../src/lib/apps/documentStore";
import { appDataKey, documentKey, type DocumentAddress } from "../../src/lib/apps/documentSchema";

const endpoint = new URL(process.env.TEST_DYNAMODB_ENDPOINT ?? "http://invalid");
if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error("Explicit disposable loopback DynamoDB endpoint required");
const table = "smartdeploy_documents_test_" + randomUUID().replaceAll("-", "");
const raw = new DynamoDBClient({ region: "us-west-2", endpoint: endpoint.origin, credentials: { accessKeyId: "localTestOnly", secretAccessKey: "localTestOnly" },
	maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 5000, httpAgent: { maxSockets: 8 } } });
const client = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: false, convertClassInstanceToMap: false } });
let now = 1792977079000;
const store = new AppDocumentStore(client, table, () => now);
let address: DocumentAddress;
const limits = { preview: { maxBytes: 10000, maxDocuments: 3 }, published: { maxBytes: 10000, maxDocuments: 3 } };
beforeAll(async () => { await raw.send(new CreateTableCommand({ TableName: table, BillingMode: "PAY_PER_REQUEST", KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }], AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }] })); });
afterAll(async () => { try { await raw.send(new DeleteTableCommand({ TableName: table })); } finally { raw.destroy(); } });
beforeEach(async () => {
	now = 1792977079000;
	address = { appId: randomUUID(), environment: "preview", collection: "inventory", id: "first" };
	await store.initialize(address.appId, limits);
});
const scope = () => ({ appId: address.appId, environment: address.environment });

describe("real DynamoDB app documents and seven-day retention", () => {
	it("round-trips a versioned document, updates quota by delta and removes it atomically", async () => {
		expect(await store.get(address)).toBeNull();
		const first = await store.put(address, '{ "title": "Mug" }', null);
		expect(first).toEqual({ collection: "inventory", id: "first", version: expect.any(String), json: '{"title":"Mug"}' });
		expect(await store.get(address)).toEqual(first);
		const before = (await store.inspect(scope())).usage;
		const next = await store.put(address, '{"title":"Mug","count":5}', first.version);
		expect(next.version).not.toBe(first.version);
		const after = (await store.inspect(scope())).usage;
		expect(after.documentCount).toBe(1);
		expect(after.usedBytes - before.usedBytes).toBe(Buffer.byteLength(next.json) - Buffer.byteLength(first.json));
		await store.remove(address, next.version);
		expect(await store.get(address)).toBeNull();
		expect((await store.inspect(scope())).usage).toMatchObject({ usedBytes: 0, documentCount: 0 });
	});
	it("separates preview, published, collections and other apps using stable release-independent keys", async () => {
		await store.put(address, '{"value":"preview"}', null);
		const published = { ...address, environment: "published" as const };
		expect(await store.get(published)).toBeNull(); await store.put(published, '{"value":"published"}', null);
		const otherApp = { ...address, appId: randomUUID() }; await store.initialize(otherApp.appId, limits);
		expect(await store.get(otherApp)).toBeNull(); await store.put(otherApp, '{"value":"other"}', null);
		expect(await store.get({ ...address, collection: "other" })).toBeNull();
		expect((await store.get(address))?.json).toContain("preview");
		expect((await store.get(published))?.json).toContain("published");
		expect((await store.inspect({ appId: address.appId, environment: "published" })).usage.documentCount).toBe(1);
	});
	it("never resets existing namespace usage by reinitializing an app", async () => {
		await store.put(address, '{}', null);
		await expect(store.initialize(address.appId, limits)).rejects.toMatchObject({ status: 409 });
		expect((await store.inspect(scope())).usage.documentCount).toBe(1);
	});
	it("denies missing namespaces without creating metadata or documents", async () => {
		await expect(store.get({ ...address, appId: randomUUID() })).rejects.toMatchObject({ status: 404 });
	});
	it("enforces version preconditions without changing usage on rejected writes/deletes", async () => {
		await store.put(address, '{}', null); const usage = (await store.inspect(scope())).usage;
		for (const version of [null, randomUUID()]) await expect(store.put(address, '{"overwrite":true}', version)).rejects.toMatchObject({ status: 409 });
		await expect(store.remove(address, randomUUID())).rejects.toMatchObject({ status: 409 });
		expect((await store.inspect(scope())).usage).toEqual(usage);
	});
	it("permits only one concurrent create for a document and charges once", async () => {
		const results = await Promise.allSettled([store.put(address, '{"writer":1}', null), store.put(address, '{"writer":2}', null)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect((await store.inspect(scope())).usage.documentCount).toBe(1);
		expect((await store.get(address))?.version).toEqual(expect.any(String));
	});
	it("rejects old update/delete tokens after a document ID is removed and recreated", async () => {
		const original = await store.put(address, '{"owner":"original"}', null);
		await store.remove(address, original.version);
		const replacement = await store.put(address, '{"owner":"replacement"}', null);
		expect(replacement.version).not.toBe(original.version);
		await expect(store.put(address, '{"stale":true}', original.version)).rejects.toMatchObject({ status: 409 });
		await expect(store.remove(address, original.version)).rejects.toMatchObject({ status: 409 });
		expect(await store.get(address)).toEqual(replacement);
		expect((await store.inspect(scope())).usage.documentCount).toBe(1);
	});
	it("never exceeds document quota when concurrent writers compete for the final slot", async () => {
		await store.put(address, '{}', null); await store.put({ ...address, id: "second" }, '{}', null);
		const results = await Promise.allSettled([store.put({ ...address, id: "third" }, '{}', null), store.put({ ...address, id: "fourth" }, '{}', null)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		expect((await store.inspect(scope())).usage.documentCount).toBe(3);
		await expect(store.put({ ...address, id: "fifth" }, '{}', null)).rejects.toMatchObject({ status: 429 });
	});
	it("enforces byte quota and returns released document capacity to that environment only", async () => {
		const appId = randomUUID(); await store.initialize(appId, { ...limits, preview: { maxBytes: 600, maxDocuments: 3 } });
		const small = { ...address, appId }; const first = await store.put(small, '{}', null);
		await expect(store.put({ ...small, id: "second" }, '{}', null)).rejects.toMatchObject({ status: 429 });
		await store.remove(small, first.version); await store.put({ ...small, id: "second" }, '{}', null);
		expect((await store.inspect({ appId, environment: "published" })).usage.usedBytes).toBe(0);
	});
	it("retains both environments and quota after deletion while denying reads and writes", async () => {
		await store.put(address, '{"private":"preview"}', null);
		const published = { ...address, environment: "published" as const }; await store.put(published, '{"private":"published"}', null);
		const usage = (await store.inspect(scope())).usage;
		const deleted = await store.markDeleted(address.appId, 0);
		expect(deleted).toEqual({ state: "deleted", version: 1, deletedAt: now, purgeAfter: now + 7 * 86400000 });
		for (const target of [address, published]) {
			await expect(store.get(target)).rejects.toMatchObject({ status: 410 });
			await expect(store.put(target, '{}', randomUUID())).rejects.toMatchObject({ status: 410 });
			await expect(store.remove(target, randomUUID())).rejects.toMatchObject({ status: 410 });
			expect((await client.send(new GetCommand({ TableName: table, Key: documentKey(target), ConsistentRead: true }))).Item?.json).toContain(target.environment);
		}
		expect((await store.inspect(scope())).usage).toEqual(usage);
	});
	it("restores documents before seven days without resetting usage or crossing environments", async () => {
		const first = await store.put(address, '{"save":true}', null); const usage = (await store.inspect(scope())).usage;
		await store.markDeleted(address.appId, 0); now += 7 * 86400000 - 1;
		expect(await store.restore(address.appId, 1)).toEqual({ state: "active", version: 2, deletedAt: null, purgeAfter: null });
		expect(await store.get(address)).toEqual(first);
		expect(await store.get({ ...address, environment: "published" })).toBeNull();
		expect((await store.inspect(scope())).usage).toEqual(usage);
	});
	it.each([0, 1, 86400000])("denies recovery at/past the seven-day cutoff (+%d)", async offset => {
		await store.markDeleted(address.appId, 0); now += 7 * 86400000 + offset;
		await expect(store.restore(address.appId, 1)).rejects.toMatchObject({ status: 410 });
	});
	it("cannot extend retention by repeating deletion or reinitialization", async () => {
		const deleted = await store.markDeleted(address.appId, 0); now += 86400000;
		await expect(store.markDeleted(address.appId, 1)).rejects.toMatchObject({ status: 409 });
		await expect(store.markDeleted(address.appId, 0)).rejects.toMatchObject({ status: 409 });
		await expect(store.initialize(address.appId, limits)).rejects.toMatchObject({ status: 409 });
		expect((await store.inspect(scope())).control).toEqual(deleted);
	});
	it("claims purge only after the deadline, cannot restore afterward, and never releases quota prematurely", async () => {
		await store.put(address, '{}', null); const usage = (await store.inspect(scope())).usage;
		await store.markDeleted(address.appId, 0);
		await expect(store.beginPurge(address.appId, 1)).rejects.toMatchObject({ status: 410 });
		now += 7 * 86400000;
		expect((await store.beginPurge(address.appId, 1)).state).toBe("purging");
		await expect(store.restore(address.appId, 2)).rejects.toMatchObject({ status: 410 });
		await expect(store.initialize(address.appId, limits)).rejects.toMatchObject({ status: 409 });
		expect((await store.inspect(scope())).usage).toEqual(usage);
		expect((await client.send(new GetCommand({ TableName: table, Key: documentKey(address) }))).Item).toBeDefined();
	});
	it("rejects a delayed write from an earlier lifecycle after deletion and restore", async () => {
		let release = () => {}; let held = false;
		const wait = new Promise<void>(resolve => { release = resolve; });
		client.middlewareStack.add((next, context) => async args => {
			if (!held && String(context.commandName).includes("TransactWrite")) { held = true; await wait; }
			return next(args);
		}, { step: "initialize", name: "holdDocumentWrite" });
		const pending = store.put(address, '{}', null); void pending.catch(() => {});
		try {
			await vi.waitFor(() => expect(held).toBe(true));
			await store.markDeleted(address.appId, 0); await store.restore(address.appId, 1); release();
			await expect(pending).rejects.toMatchObject({ status: 409 });
			expect(await store.get(address)).toBeNull(); expect((await store.inspect(scope())).usage.documentCount).toBe(0);
		} finally { release(); await pending.catch(() => {}); client.middlewareStack.remove("holdDocumentWrite"); }
	});
	it("reconciles an ambiguous committed write without double-charging or blindly replaying it", async () => {
		let failed = false;
		client.middlewareStack.add((next, context) => async args => {
			const result = await next(args);
			if (!failed && String(context.commandName).includes("TransactWrite")) { failed = true; throw new Error("transport lost: do-not-echo-credential"); }
			return result;
		}, { step: "initialize", name: "loseCommittedReply" });
		try { await expect(store.put(address, '{"committed":true}', null)).rejects.toMatchObject({ status: 503, message: "App data operation unavailable." }); }
		finally { client.middlewareStack.remove("loseCommittedReply"); }
		expect((await store.get(address))?.version).toEqual(expect.any(String));
		const usage = (await store.inspect(scope())).usage;
		await expect(store.put(address, '{"committed":true}', null)).rejects.toMatchObject({ status: 409 });
		expect((await store.inspect(scope())).usage).toEqual(usage);
	});
	it.each(['[]', 'null', 'true', '1', '{broken', '{"x":1e999}', '{"x":9007199254740993}', JSON.stringify({ x: "😀".repeat(2500) }), '{"x":'.repeat(20) + '0' + '}'.repeat(20)])("rejects invalid/oversized document JSON before a write (%#)", async json => {
		await expect(store.put(address, json, null)).rejects.toMatchObject({ status: 400 });
		expect((await store.inspect(scope())).usage.documentCount).toBe(0);
	});
	it.each(["../escape", "ENV#published", "", "a".repeat(129)])("rejects unsafe document keys (%s)", async id => {
		await expect(store.put({ ...address, id }, '{}', null)).rejects.toMatchObject({ status: 400 });
	});
	it("fails closed on corrupt stored documents without exposing their payload", async () => {
		await client.send(new PutCommand({ TableName: table, Item: { ...documentKey(address), collection: address.collection, id: address.id, version: randomUUID(), json: '{"secret":"do-not-echo"}', chargedBytes: 1 } }));
		await expect(store.get(address)).rejects.toMatchObject({ status: 503, message: "App data operation unavailable." });
	});
	it("keeps the app control tombstone without automatic TTL expiry", async () => {
		await store.markDeleted(address.appId, 0);
		const item = (await client.send(new GetCommand({ TableName: table, Key: appDataKey(address.appId, "CONTROL") }))).Item;
		expect(item).not.toHaveProperty("ttl"); expect(item).not.toHaveProperty("expiresAt");
	});
});
