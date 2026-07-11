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
	const outcomes = await Promise.all(
		records.map(async (record) => {
			const messageId = String(record.messageId ?? "").trim();
			try {
				await processDeploymentQueueMessage(record.body);
				return null;
			} catch (error) {
				console.error("[deployment-queue-handler] failed to process record:", error);
				return messageId ? { itemIdentifier: messageId } : null;
			}
		})
	);

	return {
		batchItemFailures: outcomes.filter((failure): failure is { itemIdentifier: string } => failure !== null),
	};
}
