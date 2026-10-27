import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import config from "@/config";
import { assumeDocumentRole, documentRolePolicy } from "@/lib/aws/documentRole";
import { GatewayDocumentOperation } from "./documentApiSchema";
import { AppDataError, DataScope, DocumentAddress, documentJson, type AppDocument } from "./documentSchema";
import { AppDocumentStore } from "./documentStore";

let pending = 0;
export type GatewayDocumentResult = { document: AppDocument | null } | { deleted: true };

/** Single-app pilot only. This process bound is not a global spending limit. */
async function pilotDocumentOperation(
	scope: DataScope,
	operation: GatewayDocumentOperation | null,
	signal: AbortSignal,
): Promise<GatewayDocumentResult | null> {
	if (!config.PRIVATE_APP_DOCUMENTS_ENABLED) throw new AppDataError(503);
	const allowed = z.uuid().safeParse(config.APP_DOCUMENTS_APP_ID);
	const parsedScope = DataScope.parse(scope);
	if (!allowed.success || allowed.data.toLowerCase() !== parsedScope.appId.toLowerCase())
		throw new AppDataError(403);
	if (pending >= 2 || signal.aborted) throw new AppDataError(503);
	const roleScope = { appId: parsedScope.appId, tableArn: config.APP_DOCUMENTS_TABLE_ARN, roleArn: config.APP_DOCUMENTS_ROLE_ARN, region: config.AWS_REGION };
	documentRolePolicy(roleScope);
	const parsed = operation === null ? null : GatewayDocumentOperation.parse(operation);
	const address = parsed ? DocumentAddress.parse({ ...parsedScope, collection: parsed.collection, id: parsed.id }) : null;
	const json = parsed?.action === "put" ? documentJson(parsed.json) : "";
	let client: DynamoDBDocumentClient | null = null;
	pending++;
	try {
		const credentials = await assumeDocumentRole(roleScope, signal);
		signal.throwIfAborted();
		client = DynamoDBDocumentClient.from(
			new DynamoDBClient({
				region: roleScope.region,
				credentials,
				endpoint: `https://dynamodb.${roleScope.region}.amazonaws.com`,
				maxAttempts: 1,
				requestHandler: {
					connectionTimeout: 1000,
					requestTimeout: 1800,
					throwOnRequestTimeout: true,
					httpsAgent: { keepAlive: true, maxSockets: 2 },
				},
			}),
		);
		const store = new AppDocumentStore(client, config.APP_DOCUMENTS_TABLE_ARN, Date.now, signal);
		if (!parsed || !address) {
			const snapshot = await store.inspect(parsedScope);
			if (snapshot.control.state !== "active") throw new AppDataError(410);
			return null;
		}
		if (parsed.action === "get") return { document: await store.get(address) };
		if (parsed.action === "put") return { document: await store.put(address, json, parsed.expectedVersion) };
		await store.remove(address, parsed.expectedVersion);
		return { deleted: true };
	} finally {
		// Keep admission until the SDK actually settles, including after timeout.
		pending--;
		client?.destroy();
	}
}

export async function executePilotDocument(scope: DataScope, operation: GatewayDocumentOperation, signal: AbortSignal): Promise<GatewayDocumentResult> {
	const result = await pilotDocumentOperation(scope, operation, signal);
	if (result === null) throw new AppDataError(503);
	return result;
}

/** Trusted service readiness only: reads control/quota rows, never document contents or credentials. */
export async function inspectPilotDocumentBackend(scope: DataScope, signal: AbortSignal): Promise<void> {
	await pilotDocumentOperation(scope, null, signal);
}
