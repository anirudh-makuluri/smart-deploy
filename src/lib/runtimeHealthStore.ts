import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import config from "@/config";
import type { RuntimeHealthSample } from "@/app/types";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";
import { makeRuntimeStoreKey } from "@/lib/runtimeStoreKey";

const RUNTIME_HEALTH_SORT_KEY = "runtime#health";
const DEFAULT_MAX_HEALTH_ENTRIES = 10;

type RuntimeHealthItem = {
	pk: string;
	sk: string;
	updatedAt: string;
	entries: RuntimeHealthSample[];
};

let runtimeDocumentClient: DynamoDBDocumentClient | null = null;

function getRuntimeTableName(): string {
	const tableName = config.RUNTIME_DYNAMODB_TABLE_NAME.trim();
	if (!tableName) {
		throw new Error("RUNTIME_DYNAMODB_TABLE_NAME must be set in environment");
	}
	return tableName;
}

function getRuntimeDocumentClient(): DynamoDBDocumentClient {
	if (runtimeDocumentClient) return runtimeDocumentClient;
	const client = new DynamoDBClient(getAwsClientConfig(config.AWS_REGION));
	runtimeDocumentClient = DynamoDBDocumentClient.from(client, {
		marshallOptions: {
			removeUndefinedValues: true,
		},
	});
	return runtimeDocumentClient;
}

function trimRecentHealthSamples(entries: RuntimeHealthSample[], maxEntries = DEFAULT_MAX_HEALTH_ENTRIES): RuntimeHealthSample[] {
	if (entries.length <= maxEntries) return entries;
	return entries.slice(-maxEntries);
}

export async function listRuntimeHealthSamples(args: {
	userID: string | undefined;
	repoName: string;
	serviceName: string;
}): Promise<RuntimeHealthSample[]> {
	const tableName = getRuntimeTableName();
	const client = getRuntimeDocumentClient();
	const pk = makeRuntimeStoreKey(args.userID, args.repoName, args.serviceName);
	const response = await client.send(
		new GetCommand({
			TableName: tableName,
			Key: {
				pk,
				sk: RUNTIME_HEALTH_SORT_KEY,
			},
		})
	);
	const item = response.Item as RuntimeHealthItem | undefined;
	return Array.isArray(item?.entries) ? item.entries : [];
}

export async function appendRuntimeHealthSample(args: {
	userID: string | undefined;
	repoName: string;
	serviceName: string;
	entry: RuntimeHealthSample;
	maxEntries?: number;
}): Promise<RuntimeHealthSample[]> {
	const tableName = getRuntimeTableName();
	const client = getRuntimeDocumentClient();
	const pk = makeRuntimeStoreKey(args.userID, args.repoName, args.serviceName);
	const existingEntries = await listRuntimeHealthSamples(args);
	const nextEntries = trimRecentHealthSamples(
		[...existingEntries, args.entry],
		args.maxEntries ?? DEFAULT_MAX_HEALTH_ENTRIES
	);

	await client.send(
		new PutCommand({
			TableName: tableName,
			Item: {
				pk,
				sk: RUNTIME_HEALTH_SORT_KEY,
				updatedAt: args.entry.checkedAt,
				entries: nextEntries,
			} satisfies RuntimeHealthItem,
		})
	);

	return nextEntries;
}

export const __testing = {
	DEFAULT_MAX_HEALTH_ENTRIES,
	RUNTIME_HEALTH_SORT_KEY,
	trimRecentHealthSamples,
};
