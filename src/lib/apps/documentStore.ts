import { randomUUID } from "node:crypto";
import { type DynamoDBDocumentClient, GetCommand, TransactGetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { APP_DATA_RETENTION_MS, AppDataError, DataControl, DataLimits, DataScope, DataUsage, DocumentAddress,
	appDataKey, chargedDocumentBytes, documentJson, documentKey, storedDocument, usageKey, type AppDocument } from "./documentSchema";

/** Trusted broker storage only. A scope is not authentication. No public route or app deletion adapter. */
export class AppDocumentStore {
	readonly #table: string;
	constructor(private readonly client: DynamoDBDocumentClient, tableName: string, private readonly clock: () => number = Date.now) {
		this.#table = z.string().regex(/^[A-Za-z0-9_.-]{3,255}$/).parse(tableName);
	}
	async #operation<T>(work: () => Promise<T>): Promise<T> {
		try { return await work(); }
		catch (error) {
			if (error instanceof AppDataError) throw error;
			if (error instanceof z.ZodError) throw new AppDataError(400);
			if (error instanceof Error && ["TransactionCanceledException", "ConditionalCheckFailedException", "TransactionConflictException"].includes(error.name)) throw new AppDataError(409);
			throw new AppDataError(503);
		}
	}
	#now(): number { return z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - APP_DATA_RETENTION_MS).parse(this.clock()); }
	#controlKey(appId: string) { return appDataKey(appId, "CONTROL"); }
	#control(value: unknown): DataControl {
		if (value === undefined) throw new AppDataError(404);
		const parsed = DataControl.safeParse(value); if (!parsed.success) throw new AppDataError(503); return parsed.data;
	}
	#active(control: DataControl): void { if (control.state !== "active") throw new AppDataError(410); }
	#version(version: string): string { return z.uuid().parse(version); }

	async initialize(appId: string, limits: { preview: DataLimits; published: DataLimits }): Promise<void> {
		return this.#operation(async () => {
			const initial = DataControl.parse({ state: "active", version: 0, deletedAt: null, purgeAfter: null });
			const items = [{ ...this.#controlKey(appId), ...initial }, ...(["preview", "published"] as const).map(environment => ({
				...usageKey({ appId, environment }), ...DataLimits.parse(limits[environment]), usedBytes: 0, documentCount: 0,
			}))];
			await this.client.send(new TransactWriteCommand({ ClientRequestToken: randomUUID(), TransactItems: items.map(Item => ({ Put: {
				TableName: this.#table, Item, ConditionExpression: "attribute_not_exists(pk)",
			} })) }));
		});
	}
	/** Operator projection: retained usage remains visible while ordinary document reads are denied. */
	async inspect(scope: DataScope): Promise<{ control: DataControl; usage: DataUsage }> {
		return this.#operation(async () => {
			const parsed = DataScope.parse(scope);
			const result = await this.client.send(new TransactGetCommand({ TransactItems: [this.#controlKey(parsed.appId), usageKey(parsed)].map(Key => ({ Get: { TableName: this.#table, Key } })) }));
			const control = this.#control(result.Responses?.[0].Item);
			const usage = DataUsage.safeParse(result.Responses?.[1].Item); if (!usage.success) throw new AppDataError(503);
			return { control, usage: usage.data };
		});
	}
	async #snapshot(address: DocumentAddress) {
		const result = await this.client.send(new TransactGetCommand({ TransactItems: [this.#controlKey(address.appId), usageKey(address), documentKey(address)].map(Key => ({ Get: { TableName: this.#table, Key } })) }));
		const control = this.#control(result.Responses?.[0].Item); this.#active(control);
		const usage = DataUsage.safeParse(result.Responses?.[1].Item); if (!usage.success) throw new AppDataError(503);
		return { control, usage: usage.data, document: storedDocument(result.Responses?.[2].Item, address) };
	}
	async get(address: DocumentAddress): Promise<AppDocument | null> {
		return this.#operation(async () => {
			const { document } = await this.#snapshot(DocumentAddress.parse(address));
			return document ? { collection: document.collection, id: document.id, version: document.version, json: document.json } : null;
		});
	}
	#activeCondition(appId: string, version: number) {
		return { ConditionCheck: { TableName: this.#table, Key: this.#controlKey(appId), ConditionExpression: "#state = :active and #version = :version",
			ExpressionAttributeNames: { "#state": "state", "#version": "version" }, ExpressionAttributeValues: { ":active": "active", ":version": version } } };
	}
	#usageUpdate(scope: DataScope, usage: DataUsage, bytes: number, count: number) {
		return { Update: { TableName: this.#table, Key: usageKey(scope), UpdateExpression: "ADD usedBytes :bytes, documentCount :count",
			ConditionExpression: "usedBytes BETWEEN :minBytes AND :maxBytes AND documentCount BETWEEN :minCount AND :maxCount AND maxBytes = :capBytes AND maxDocuments = :capCount",
			ExpressionAttributeValues: { ":bytes": bytes, ":count": count, ":minBytes": Math.max(0, -bytes), ":maxBytes": usage.maxBytes - bytes,
				":minCount": Math.max(0, -count), ":maxCount": usage.maxDocuments - count, ":capBytes": usage.maxBytes, ":capCount": usage.maxDocuments } } };
	}
	async put(address: DocumentAddress, input: string, expectedVersion: string | null): Promise<AppDocument> {
		return this.#operation(async () => {
			const parsed = DocumentAddress.parse(address); const json = documentJson(input);
			if (expectedVersion !== null) this.#version(expectedVersion);
			const { control, usage, document } = await this.#snapshot(parsed);
			if ((document?.version ?? null) !== expectedVersion) throw new AppDataError(409);
			const chargedBytes = chargedDocumentBytes(parsed, json); const bytes = chargedBytes - (document?.chargedBytes ?? 0); const count = document ? 0 : 1;
			if (usage.usedBytes + bytes > usage.maxBytes || usage.documentCount + count > usage.maxDocuments) throw new AppDataError(429);
			const version = randomUUID();
			await this.client.send(new TransactWriteCommand({ ClientRequestToken: randomUUID(), TransactItems: [
				this.#activeCondition(parsed.appId, control.version),
				{ Put: { TableName: this.#table, Item: { ...documentKey(parsed), collection: parsed.collection, id: parsed.id, json, version, chargedBytes },
					ConditionExpression: expectedVersion === null ? "attribute_not_exists(pk)" : "#version = :version",
					...(expectedVersion === null ? {} : { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": expectedVersion } }) } },
				this.#usageUpdate(parsed, usage, bytes, count),
			] }));
			return { collection: parsed.collection, id: parsed.id, version, json };
		});
	}
	async remove(address: DocumentAddress, expectedVersion: string): Promise<void> {
		return this.#operation(async () => {
			const parsed = DocumentAddress.parse(address); this.#version(expectedVersion);
			const { control, usage, document } = await this.#snapshot(parsed);
			if (!document) throw new AppDataError(404); if (document.version !== expectedVersion) throw new AppDataError(409);
			await this.client.send(new TransactWriteCommand({ ClientRequestToken: randomUUID(), TransactItems: [this.#activeCondition(parsed.appId, control.version),
				{ Delete: { TableName: this.#table, Key: documentKey(parsed), ConditionExpression: "#version = :version", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": expectedVersion } } },
				this.#usageUpdate(parsed, usage, -document.chargedBytes, -1),
			] }));
		});
	}
	/** Data lifecycle only: the app-delete coordinator must first revoke access/runtime credentials. */
	async markDeleted(appId: string, expectedVersion: number): Promise<DataControl> {
		return this.#changeState(appId, expectedVersion, "deleted");
	}
	async restore(appId: string, expectedVersion: number): Promise<DataControl> { return this.#changeState(appId, expectedVersion, "active"); }
	/** Irreversible cleanup claim. Does not erase records or release any quota. */
	async beginPurge(appId: string, expectedVersion: number): Promise<DataControl> { return this.#changeState(appId, expectedVersion, "purging"); }
	async #changeState(appId: string, expectedVersion: number, state: DataControl["state"]): Promise<DataControl> {
		return this.#operation(async () => {
			z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).parse(expectedVersion);
			const key = this.#controlKey(appId);
			const stored = await this.client.send(new GetCommand({ TableName: this.#table, Key: key, ConsistentRead: true })); const current = this.#control(stored.Item);
			const now = this.#now();
			if (current.version !== expectedVersion) throw new AppDataError(409);
			if (state === "deleted") { if (current.state !== "active") throw new AppDataError(409); }
			else if (current.state !== "deleted" || current.purgeAfter === null || (state === "active" ? now >= current.purgeAfter : now < current.purgeAfter)) throw new AppDataError(410);
			const next = DataControl.parse({ state, version: current.version + 1, deletedAt: state === "active" ? null : state === "deleted" ? now : current.deletedAt,
				purgeAfter: state === "active" ? null : state === "deleted" ? now + APP_DATA_RETENTION_MS : current.purgeAfter });
			await this.client.send(new UpdateCommand({ TableName: this.#table, Key: key, UpdateExpression: "SET #state=:next, #version=:nextVersion, deletedAt=:deleted, purgeAfter=:purge",
				ConditionExpression: "#state=:previous and #version=:version" + (state === "deleted" ? "" : state === "active" ? " and purgeAfter > :now" : " and purgeAfter <= :now"),
				ExpressionAttributeNames: { "#state": "state", "#version": "version" }, ExpressionAttributeValues: { ":next": next.state, ":nextVersion": next.version,
					":deleted": next.deletedAt, ":purge": next.purgeAfter, ":previous": current.state, ":version": expectedVersion, ...(state === "deleted" ? {} : { ":now": now }) } }));
			return next;
		});
	}
}
