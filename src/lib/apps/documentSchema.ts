import { z } from "zod";

export const APP_DATA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export class AppDataError extends Error {
	constructor(public readonly status: number) { super("App data operation unavailable."); }
}
export const AppDocumentTable = z.string().max(400).regex(/^(?:[A-Za-z0-9_.-]{3,255}|arn:aws:dynamodb:[a-z0-9-]+:[0-9]{12}:table\/[A-Za-z0-9_.-]{3,255})$/);
export const DataScope = z.strictObject({ appId: z.uuid(), environment: z.enum(["preview", "published"]) });
export type DataScope = z.infer<typeof DataScope>;
export const DocumentAddress = DataScope.extend({ collection: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
export type DocumentAddress = z.infer<typeof DocumentAddress>;
const Counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DataLimits = z.strictObject({ maxBytes: Counter.positive().max(100 * 1024 * 1024), maxDocuments: Counter.positive().max(10000) });
export type DataLimits = z.infer<typeof DataLimits>;
export const DataControl = z.object({ state: z.enum(["active", "deleted", "purging"]), version: Counter,
	deletedAt: Counter.nullable(), purgeAfter: Counter.nullable() }).refine(row => row.state === "active"
	? row.deletedAt === null && row.purgeAfter === null
	: row.deletedAt !== null && row.purgeAfter === row.deletedAt + APP_DATA_RETENTION_MS);
export type DataControl = z.infer<typeof DataControl>;
export const DataUsage = z.object({ ...DataLimits.shape, usedBytes: Counter, documentCount: Counter }).refine(row => row.usedBytes <= row.maxBytes && row.documentCount <= row.maxDocuments);
export type DataUsage = z.infer<typeof DataUsage>;
export const StoredDocument = z.object({ collection: DocumentAddress.shape.collection, id: DocumentAddress.shape.id,
	version: z.uuid(), json: z.string().max(8192), chargedBytes: Counter.positive() });
export type StoredDocument = z.infer<typeof StoredDocument>;
export interface AppDocument { collection: string; id: string; version: string; json: string }

export function appDataKey(appId: string, sort: string): { pk: string; sk: string } {
	return { pk: "APP#" + z.uuid().parse(appId).toLowerCase(), sk: sort };
}
export function usageKey(scope: DataScope): { pk: string; sk: string } {
	const parsed = DataScope.parse({ appId: scope.appId, environment: scope.environment }); return appDataKey(parsed.appId, "ENV#" + parsed.environment + "#USAGE");
}
export function documentKey(address: DocumentAddress): { pk: string; sk: string } {
	const parsed = DocumentAddress.parse(address); return appDataKey(parsed.appId, `ENV#${parsed.environment}#DOC#${parsed.collection}#${parsed.id}`);
}
export function documentJson(input: string): string {
	if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > 8192) throw new AppDataError(400);
	try {
		const parsed: unknown = JSON.parse(input);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Object required");
		const visit = (value: unknown, depth: number): void => {
			if (depth > 16) throw new Error("Document too deep");
			if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Nonfinite number");
			if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error("Unsafe integer");
			if (value && typeof value === "object") for (const item of Object.values(value)) visit(item, depth + 1);
		};
		visit(parsed, 0);
		const normalized = JSON.stringify(parsed);
		if (Buffer.byteLength(normalized, "utf8") > 8192) throw new Error("Normalized document too large");
		return normalized;
	} catch { throw new AppDataError(400); }
}
export function chargedDocumentBytes(address: DocumentAddress, json: string): number {
	// Conservative logical reservation includes fixed metadata and bounded key overhead.
	return Buffer.byteLength(json, "utf8") + 512 + Buffer.byteLength(address.collection + address.id, "utf8");
}
export function storedDocument(value: unknown, address: DocumentAddress): StoredDocument | null {
	if (value === undefined) return null;
	try {
		const parsed = StoredDocument.extend({ pk: z.string(), sk: z.string() }).parse(value); const key = documentKey(address);
		if (parsed.pk !== key.pk || parsed.sk !== key.sk || parsed.collection !== address.collection || parsed.id !== address.id
			|| parsed.json !== documentJson(parsed.json) || parsed.chargedBytes !== chargedDocumentBytes(address, parsed.json)) throw new Error("Invalid stored document");
		return parsed;
	} catch { throw new AppDataError(503); }
}
