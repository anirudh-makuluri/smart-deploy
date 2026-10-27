import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configuration: vi.fn() }));
vi.mock("@/lib/aws/sdkClients", () => ({ getAwsClientConfig: (region: string) => ({ region, credentials: { accessKeyId: "platform-base", secretAccessKey: "not-app-credentials" } }) }));
vi.mock("@aws-sdk/client-sts", () => ({ STSClient: class { constructor(config: unknown) { mocks.configuration(config); } send = mocks.send; destroy = mocks.destroy; }, AssumeRoleCommand: class { constructor(readonly input: unknown) {} } }));
import { assumeDocumentRole, documentRolePolicy, type DocumentRoleScope } from "@/lib/aws/documentRole";

const SCOPE: DocumentRoleScope = { appId: "11111111-1111-4111-8111-111111111111", tableArn: "arn:aws:dynamodb:us-west-2:111122223333:table/pilot-documents", roleArn: "arn:aws:iam::111122223333:role/pilot-documents", region: "us-west-2" };
function receipt(sessionName: string) { return { AssumedRoleUser: { Arn: `arn:aws:sts::111122223333:assumed-role/pilot-documents/${sessionName}` }, Credentials: { AccessKeyId: "ASIA" + "A".repeat(16), SecretAccessKey: "s".repeat(40), SessionToken: "t".repeat(64), Expiration: new Date(Date.now() + 900000) } }; }
beforeEach(() => { vi.clearAllMocks(); mocks.send.mockImplementation(async (command: { input: { RoleSessionName: string } }) => receipt(command.input.RoleSessionName)); });
afterEach(() => { vi.useRealTimers(); });
describe("app-only document credentials", () => {
	it("limits the policy to one table, app partition and transactional item operations", () => {
		const policy = documentRolePolicy(SCOPE); expect(policy.Statement).toHaveLength(2);
		const partition = { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": ["APP#" + SCOPE.appId] }, Null: { "dynamodb:LeadingKeys": "false" } };
		expect(policy.Statement[0]).toEqual({ Effect: "Allow", Resource: SCOPE.tableArn, Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Condition: { ...partition, StringEquals: { "dynamodb:EnclosingOperation": ["TransactGetItems", "TransactWriteItems"] } } });
		expect(policy.Statement[1]).toEqual({ Effect: "Allow", Resource: SCOPE.tableArn, Action: ["dynamodb:ConditionCheckItem"], Condition: partition });
	});
	it.each([
		{ roleArn: "" }, { roleArn: "arn:aws:iam::999999999999:role/pilot-documents" }, { roleArn: SCOPE.roleArn + "\n" },
		{ roleArn: "arn:aws:iam::111122223333:role/path/pilot-documents" }, { tableArn: SCOPE.tableArn + "\n" },
		{ tableArn: SCOPE.tableArn + "/index/foreign" }, { region: "us-east-1" }, { appId: "not-an-app" },
	])("rejects invalid operator configuration before STS construction", async override => {
		await expect(assumeDocumentRole({ ...SCOPE, ...override }, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(mocks.configuration).not.toHaveBeenCalled();
	});
	it("requests a short-lived session with the permission ceiling and returns only mandatory temporary credentials", async () => {
		const signal = new AbortController().signal; const result = await assumeDocumentRole(SCOPE, signal);
		expect(result).toEqual({ accessKeyId: "ASIA" + "A".repeat(16), secretAccessKey: "s".repeat(40), sessionToken: "t".repeat(64), expiration: expect.any(Date) });
		expect(mocks.send).toHaveBeenCalledOnce(); const [command, options] = mocks.send.mock.calls[0]; expect(command.input).toMatchObject({ RoleArn: SCOPE.roleArn, DurationSeconds: 900, Policy: JSON.stringify(documentRolePolicy(SCOPE)) }); expect(command.input.RoleSessionName).toMatch(/^sdp-docs-[a-f0-9-]{36}$/); expect(options).toEqual({ abortSignal: signal });
		expect(mocks.configuration).toHaveBeenCalledWith(expect.objectContaining({ region: "us-west-2", endpoint: "https://sts.us-west-2.amazonaws.com", maxAttempts: 1, requestHandler: expect.objectContaining({ requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 2 } }) })); expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it.each(["account", "role", "session", "missingToken", "nearExpiry", "longExpiry", "invalidExpiry"])("rejects an unexpected or unusable STS result (%s) without a credential fallback", async variant => {
		mocks.send.mockImplementation(async (command: { input: { RoleSessionName: string } }) => {
			const value = receipt(command.input.RoleSessionName);
			if (variant === "account") value.AssumedRoleUser.Arn = value.AssumedRoleUser.Arn.replace("111122223333", "999999999999");
			if (variant === "role") value.AssumedRoleUser.Arn = value.AssumedRoleUser.Arn.replace("pilot-documents", "foreign-role");
			if (variant === "session") value.AssumedRoleUser.Arn += "foreign";
			if (variant === "missingToken") value.Credentials.SessionToken = "";
			if (variant === "nearExpiry") value.Credentials.Expiration = new Date(Date.now() + 10000);
			if (variant === "longExpiry") value.Credentials.Expiration = new Date(Date.now() + 3600000);
			if (variant === "invalidExpiry") value.Credentials.Expiration = new Date("invalid");
			return value;
		});
		await expect(assumeDocumentRole(SCOPE, new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it("redacts provider failures and destroys its client", async () => {
		mocks.send.mockRejectedValue(Error("provider secret details")); await expect(assumeDocumentRole(SCOPE, new AbortController().signal)).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining("provider secret") }); expect(mocks.send).toHaveBeenCalledOnce(); expect(mocks.destroy).toHaveBeenCalledOnce();
	});
	it("does not construct a client after cancellation", async () => {
		await expect(assumeDocumentRole(SCOPE, AbortSignal.abort())).rejects.toMatchObject({ status: 503 }); expect(mocks.configuration).not.toHaveBeenCalled();
	});
	it("forwards cancellation and discards a late valid credential response", async () => {
		let finish = (_value: ReturnType<typeof receipt>) => {}; let sessionName = "";
		mocks.send.mockImplementation((command: { input: { RoleSessionName: string } }) => { sessionName = command.input.RoleSessionName; return new Promise(resolve => { finish = resolve; }); });
		const controller = new AbortController(); const result = assumeDocumentRole(SCOPE, controller.signal); controller.abort(); finish(receipt(sessionName));
		await expect(result).rejects.toMatchObject({ status: 503 }); expect(mocks.destroy).toHaveBeenCalledOnce();
	});
});
