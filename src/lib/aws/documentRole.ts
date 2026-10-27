import { randomUUID } from "node:crypto";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { z } from "zod";
import { AppDataError } from "../apps/documentSchema";
import { getAwsClientConfig } from "./sdkClients";

export interface DocumentRoleScope { appId: string; tableArn: string; roleArn: string; region: string }
export interface DocumentRoleCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }
const Scope = z.strictObject({ appId: z.uuid(), tableArn: z.string().max(512), roleArn: z.string().max(512), region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/) });
const Table = /^arn:aws:dynamodb:([a-z]{2}-[a-z]+-\d):([0-9]{12}):table\/([A-Za-z0-9_.-]{3,255})$/;
const Role = /^arn:aws:iam::([0-9]{12}):role\/([A-Za-z0-9+=,.@_-]{1,64})$/;
const Credentials = z.object({ AccessKeyId: z.string().min(16).max(128), SecretAccessKey: z.string().min(32).max(128), SessionToken: z.string().min(16).max(8192), Expiration: z.date() });
function configuration(input: DocumentRoleScope) {
	const parsed = Scope.safeParse(input); const table = Table.exec(input.tableArn); const role = Role.exec(input.roleArn);
	if (!parsed.success || !table || table[0] !== input.tableArn || !role || role[0] !== input.roleArn || table[1] !== input.region || table[2] !== role[1]) throw new AppDataError(503);
	return { accountId: table[2], roleName: role[2] };
}

/** Same permission ceiling for the dedicated role and every assumed session.
 * Environment authorization remains in the broker; these keys isolate one app. */
export function documentRolePolicy(input: DocumentRoleScope) {
	configuration(input);
	const appCondition = {
		"ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["APP#" + input.appId.toLowerCase()] },
		Null: { "dynamodb:LeadingKeys": "false" },
	};
	return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Resource: input.tableArn,
		Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
		Condition: { ...appCondition,
			StringEquals: { "dynamodb:EnclosingOperation": ["TransactGetItems", "TransactWriteItems"] },
		},
	}, {
		// This transaction permission has no standalone API and does not support EnclosingOperation.
		Effect: "Allow", Resource: input.tableArn, Action: ["dynamodb:ConditionCheckItem"], Condition: appCondition,
	}] };
}

/** No default-credential fallback, disk persistence, shared credential cache or SDK logging. */
export async function assumeDocumentRole(input: DocumentRoleScope, signal: AbortSignal): Promise<DocumentRoleCredentials> {
	const expected = configuration(input); const policy = documentRolePolicy(input);
	if (signal.aborted) throw new AppDataError(503);
	const sessionName = "sdp-docs-" + randomUUID();
	const client = new STSClient({ ...getAwsClientConfig(input.region), endpoint: `https://sts.${input.region}.amazonaws.com`, maxAttempts: 1,
		requestHandler: { connectionTimeout: 1000, requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 2 } } });
	try {
		const result = await client.send(new AssumeRoleCommand({ RoleArn: input.roleArn, RoleSessionName: sessionName, DurationSeconds: 900, Policy: JSON.stringify(policy) }), { abortSignal: signal });
		signal.throwIfAborted(); const parsed = Credentials.safeParse(result.Credentials); const now = Date.now();
		if (result.AssumedRoleUser?.Arn !== `arn:aws:sts::${expected.accountId}:assumed-role/${expected.roleName}/${sessionName}`
			|| !parsed.success || !(parsed.data.Expiration.getTime() > now + 30000 && parsed.data.Expiration.getTime() <= now + 1200000)) throw new AppDataError(503);
		const credentials = parsed.data;
		return { accessKeyId: credentials.AccessKeyId, secretAccessKey: credentials.SecretAccessKey, sessionToken: credentials.SessionToken, expiration: credentials.Expiration };
	} catch { throw new AppDataError(503); }
	finally { client.destroy(); }
}
