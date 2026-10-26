import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";
import { GatewayDocumentOperation } from "./documentApiSchema";
import { AppDataError, DataScope, DocumentAddress, documentJson, type AppDocument } from "./documentSchema";
import { AppDocumentStore } from "./documentStore";

const TableArn = /^arn:aws:dynamodb:([a-z0-9-]{1,32}):[0-9]{12}:table\/[A-Za-z0-9_.-]{3,255}$/;
let pending = 0;
export type GatewayDocumentResult = { document: AppDocument | null } | { deleted: true };

/** Single-app pilot only. This process bound is not a global spending limit. */
export async function executePilotDocument(
	scope: DataScope,
	operation: GatewayDocumentOperation,
	signal: AbortSignal,
): Promise<GatewayDocumentResult> {
	if (!config.PRIVATE_APP_DOCUMENTS_ENABLED) throw new AppDataError(503);
	const allowed = z.uuid().safeParse(config.APP_DOCUMENTS_APP_ID);
	const parsedScope = DataScope.parse(scope);
	if (!allowed.success || allowed.data.toLowerCase() !== parsedScope.appId.toLowerCase())
		throw new AppDataError(403);
	const table = TableArn.exec(config.APP_DOCUMENTS_TABLE_ARN);
	if (!table || table[1] !== config.AWS_REGION || pending >= 2 || signal.aborted) throw new AppDataError(503);
	const parsed = GatewayDocumentOperation.parse(operation);
	const address = DocumentAddress.parse({ ...parsedScope, collection: parsed.collection, id: parsed.id });
	const json = parsed.action === "put" ? documentJson(parsed.json) : "";
	const client = DynamoDBDocumentClient.from(
		new DynamoDBClient({
			...getAwsClientConfig(table[1]),
			endpoint: `https://dynamodb.${table[1]}.amazonaws.com`,
			maxAttempts: 1,
			requestHandler: {
				connectionTimeout: 1000,
				requestTimeout: 1800,
				throwOnRequestTimeout: true,
				httpsAgent: { keepAlive: true, maxSockets: 2 },
			},
		}),
	);
	pending++;
	try {
		const store = new AppDocumentStore(client, config.APP_DOCUMENTS_TABLE_ARN, Date.now, signal);
		if (parsed.action === "get") return { document: await store.get(address) };
		if (parsed.action === "put") return { document: await store.put(address, json, parsed.expectedVersion) };
		await store.remove(address, parsed.expectedVersion);
		return { deleted: true };
	} finally {
		// Keep admission until the SDK actually settles, including after timeout.
		pending--;
		client.destroy();
	}
}
