import dotenv from "dotenv";
dotenv.config();

import { processDeploymentQueueMessage } from "@/lib/deploymentQueueProcessor";

type SqsRecord = {
	messageId?: string;
	body?: string;
};

type SqsEvent = {
	Records?: SqsRecord[];
};

type SqsBatchResponse = {
	batchItemFailures: Array<{ itemIdentifier: string }>;
};

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
	const records = Array.isArray(event.Records) ? event.Records : [];
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];

	for (const record of records) {
		const messageId = String(record.messageId ?? "").trim();
		try {
			await processDeploymentQueueMessage(record.body);
		} catch (error) {
			console.error("[deployment-queue-handler] failed to process record:", error);
			if (messageId) {
				batchItemFailures.push({ itemIdentifier: messageId });
			}
		}
	}

	return { batchItemFailures };
}
