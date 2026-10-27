import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoGuardTemplate } from "../../../scripts/build-demo-guard.mjs";

describe("independent demo guard artifact", () => {
	it("embeds the reviewed standalone cleanup source with an exact source hash", async () => {
		const template = await buildDemoGuardTemplate(); const source = await readFile(path.resolve("src/lib/aws/demoCleanup.ts"), "utf8");
		expect(template.Metadata.CleanupSourceSha256).toBe(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"));
		expect(template.Resources.CleanupFunction.Properties.Code.ZipFile).toContain("exports.handler = handler");
		expect(template.Resources.CleanupFunction.Properties.Code.ZipFile).not.toMatch(/require\(["']\./);
		expect(Buffer.byteLength(JSON.stringify(template, null, 2))).toBeLessThanOrEqual(51200);
	});
	it("creates only the independent cleanup control plane, never application runtime or data", async () => {
		const template = await buildDemoGuardTemplate(); const types = Object.values(template.Resources).map(resource => resource.Type);
		expect(types.every(type => ["AWS::Scheduler::ScheduleGroup", "AWS::Scheduler::Schedule", "AWS::IAM::Role", "AWS::Lambda::Function", "AWS::Lambda::EventInvokeConfig", "AWS::SQS::Queue", "AWS::Logs::LogGroup"].includes(type))).toBe(true);
		expect(template.Resources.CleanupFunction.Properties.ReservedConcurrentExecutions).toBe(1);
		expect(template.Resources.CleanupDlq.Properties.SqsManagedSseEnabled).toBe(true); expect(template.Resources.CleanupDlq.DeletionPolicy).toBe("Retain");
	});
	it("bounds schedule, async retries, execution and log retention", async () => {
		const template = await buildDemoGuardTemplate(); const schedule = template.Resources.CleanupSchedule.Properties;
		expect(schedule).toMatchObject({ State: "ENABLED", ScheduleExpression: "rate(1 minute)", FlexibleTimeWindow: { Mode: "OFF" }, StartDate: { Ref: "CleanupStartUtc" }, EndDate: { Ref: "CleanupEndUtc" } });
		expect(schedule.Target.RetryPolicy).toEqual({ MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 3 });
		expect(template.Resources.CleanupAsyncDelivery.Properties).toMatchObject({ MaximumEventAgeInSeconds: 300, MaximumRetryAttempts: 1 });
		expect(template.Resources.CleanupFunction.Properties.Timeout).toBe(60); expect(template.Resources.CleanupLogs.Properties.RetentionInDays).toBe(7);
	});
	it("requires exact worker/ENI ownership leases and does not grant app-data deletion", async () => {
		const template = await buildDemoGuardTemplate(); const statements = template.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement;
		for (const action of ["ec2:StopInstances", "ec2:ModifyNetworkInterfaceAttribute"]) {
			const permission = statements.find(row => row.Action === action); expect(permission?.Resource).not.toBe("*");
			expect(permission?.Condition).toEqual({ StringEquals: { "ec2:ResourceTag/smartdeploy:demo-id": { Ref: "DemoId" } } });
		}
		const actions = statements.flatMap(row => Array.isArray(row.Action) ? row.Action : [row.Action]);
		expect(actions).not.toContain("dynamodb:DeleteTable"); expect(actions).not.toContain("s3:DeleteBucket"); expect(actions).not.toContain("ec2:TerminateInstances");
		expect(actions).not.toContain("ssm:GetParameter"); expect(actions).not.toContain("ssm:GetParameters");
	});
	it("restricts Scheduler trust to the exact schedule group/account and DNS to one wildcard delete", async () => {
		const template = await buildDemoGuardTemplate();
		expect(template.Resources.SchedulerRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition).toEqual({ StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" }, "aws:SourceArn": { "Fn::GetAtt": ["CleanupGroup", "Arn"] } } });
		const dns = template.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement.find(row => row.Action === "route53:ChangeResourceRecordSets");
		expect(dns?.Condition).toEqual({ "ForAllValues:StringEquals": { "route53:ChangeResourceRecordSetsNormalizedRecordNames": [{ "Fn::Sub": "\\052.${AppDomain}" }], "route53:ChangeResourceRecordSetsActions": ["DELETE"], "route53:ChangeResourceRecordSetsRecordTypes": ["A"] } });
	});
	it("can remove both environment target groups and rules only on the owned ALB", async () => {
		const template = await buildDemoGuardTemplate(); const statements = template.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement;
		expect(statements.find(row => row.Action === "elasticloadbalancing:DeleteTargetGroup")?.Resource).toEqual(["pub", "prev"].map(environment => ({ "Fn::Sub": `arn:aws:elasticloadbalancing:\${AWS::Region}:\${AWS::AccountId}:targetgroup/sdp-\${DemoId}-${environment}/*` })));
		expect(statements.find(row => row.Action === "elasticloadbalancing:DeleteRule")?.Resource).toEqual({ "Fn::Sub": "arn:aws:elasticloadbalancing:${AWS::Region}:${AWS::AccountId}:listener-rule/app/sdp-${DemoId}-alb/*/*/*" });
	});
	it("includes registry-documented deletion dependencies without permitting new workloads or KMS grants", async () => {
		const template = await buildDemoGuardTemplate(); const statements = template.Resources.CleanupRole.Properties.Policies[0].PolicyDocument.Statement; const actions = statements.flatMap(row => Array.isArray(row.Action) ? row.Action : [row.Action]);
		for (const action of ["ec2:DescribeSecurityGroupRules", "elasticloadbalancing:DescribeRules", "iam:TagRole", "iam:UntagRole", "route53:ListHostedZones"]) expect(actions).toContain(action);
		expect(statements.find(row => row.Action === "iam:PassRole")).toEqual({ Effect: "Allow", Action: "iam:PassRole", Resource: { "Fn::Sub": "arn:aws:iam::${AWS::AccountId}:role/sdp-${DemoId}-execution" }, Condition: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } } });
		for (const action of ["ecs:RunTask", "ecs:CreateService", "ec2:StartInstances", "kms:RetireGrant", "dynamodb:DeleteTable"]) expect(actions).not.toContain(action);
	});
});
