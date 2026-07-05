import {
	SendMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import config from "@/config";
import { getAwsClientConfig } from "@/lib/aws/sdkClients";

export type DeploymentQueueMessage = {
	runId: string;
	userId: string;
	repoName: string;
	serviceName: string;
};

function isFifoQueue(url: string): boolean {
	return url.trim().toLowerCase().endsWith(".fifo");
}

export function buildDeploymentQueueMessageGroupId(args: {
	userId: string;
	repoName: string;
	serviceName: string;
}): string {
	return `${args.userId}:${args.repoName}:${args.serviceName}`;
}

export async function enqueueDeploymentRun(message: DeploymentQueueMessage): Promise<void> {
	const queueUrl = config.DEPLOYMENT_QUEUE_URL.trim();
	if (!queueUrl) {
		throw new Error("DEPLOYMENT_QUEUE_URL is not configured.");
	}

	const client = new SQSClient(getAwsClientConfig(config.AWS_REGION));
	const command = new SendMessageCommand({
		QueueUrl: queueUrl,
		MessageBody: JSON.stringify(message),
		...(isFifoQueue(queueUrl)
			? {
				MessageGroupId: buildDeploymentQueueMessageGroupId(message),
				MessageDeduplicationId: message.runId,
			}
			: {}),
	});

	await client.send(command);
}

export const __testing = {
	buildDeploymentQueueMessageGroupId,
	isFifoQueue,
};
