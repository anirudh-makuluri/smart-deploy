import fs from "fs";
import path from "path";
import archiver from "archiver";
import config from "../../config";
import { createWebSocketLogger } from "../websocketLogger";
import { getAwsClientConfig } from "./sdkClients";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
	EC2Client,
	DescribeVpcsCommand,
	DescribeSubnetsCommand,
	DescribeAvailabilityZonesCommand,
	CreateDefaultSubnetCommand,
	DescribeSecurityGroupsCommand,
	CreateSecurityGroupCommand,
	AuthorizeSecurityGroupIngressCommand,
	DescribeInstancesCommand,
	ModifyInstanceAttributeCommand,
	RebootInstancesCommand,
	TerminateInstancesCommand,
	RunInstancesCommand,
	DescribeKeyPairsCommand,
	CreateKeyPairCommand,
	DescribeImagesCommand,
	DescribeRouteTablesCommand,
	waitUntilInstanceRunning,
} from "@aws-sdk/client-ec2";
import {
	ElasticLoadBalancingV2Client,
	DescribeLoadBalancersCommand,
	CreateLoadBalancerCommand,
	DescribeTargetGroupsCommand,
	CreateTargetGroupCommand,
	DescribeListenersCommand,
	ModifyListenerCommand,
	CreateListenerCommand,
	DescribeRulesCommand,
	ModifyRuleCommand,
	CreateRuleCommand,
	RegisterTargetsCommand,
	DeleteRuleCommand,
	DeregisterTargetsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
	IAMClient,
	GetInstanceProfileCommand,
	CreateRoleCommand,
	AttachRolePolicyCommand,
	CreateInstanceProfileCommand,
	AddRoleToInstanceProfileCommand,
} from "@aws-sdk/client-iam";
import { SSMClient, DescribeInstanceInformationCommand } from "@aws-sdk/client-ssm";
import {
	RDSClient,
	DescribeDBSubnetGroupsCommand,
	CreateDBSubnetGroupCommand,
	DescribeDBInstancesCommand,
	CreateDBInstanceCommand,
	DeleteDBInstanceCommand,
} from "@aws-sdk/client-rds";

/**
 * Sets up AWS credentials for SDK usage (and any subprocesses if needed).
 */
export async function setupAWSCredentials(ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);

	send("Setting up AWS credentials...", 'auth');

	// Set AWS environment variables for SDKs and any subprocesses
	// If access keys are provided, use them. Otherwise, SDK will use IAM instance role (if on EC2)
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
		send("Using access keys from configuration", 'auth');
	} else {
		send("No access keys found - using IAM instance role (if on EC2) or default credentials", 'auth');
	}

	process.env.AWS_DEFAULT_REGION = config.AWS_REGION;

	// Verify credentials
	try {
		const identityOutput = await runAWSCommand(
			["sts", "get-caller-identity", "--output", "json"],
			ws,
			"auth"
		);

		// Parse and display identity info
		try {
			const identity = JSON.parse(identityOutput.trim().split('\n').pop() || '{}');
			if (identity.Arn) {
				send(`Authenticated as: ${identity.Arn}`, 'auth');
			}
		} catch {
			// Ignore parsing errors
		}

		send("AWS credentials verified successfully", 'auth');
	} catch (error: any) {
		send(`AWS credentials verification failed: ${error.message}`, 'auth');
		if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
			send("Tip: If not on EC2, provide AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env", 'auth');
		}
		throw new Error("Failed to authenticate with AWS. Please check your credentials or IAM instance role.");
	}
}

// AWS SDK command runner lives below (replaces AWS CLI dependency).
type ParsedAwsArgs = {
	service: string;
	command: string;
	options: Record<string, string | string[]>;
	positionals: string[];
};

function normalizeOptValue(v: string): string {
	const trimmed = v.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseAwsArgs(args: string[]): ParsedAwsArgs {
	const service = args[0] || "";
	const command = args[1] || "";
	const options: Record<string, string | string[]> = {};
	const positionals: string[] = [];
	const multiValueKeys = new Set([
		"filters",
		"subnet-ids",
		"subnets",
		"security-groups",
		"security-group-ids",
		"vpc-security-group-ids",
		"instance-ids",
		"key-names",
		"owners",
		"image-ids",
		"group-ids",
		"names",
		"load-balancer-arns",
	]);

	const addOpt = (key: string, value: string) => {
		const v = normalizeOptValue(value);
		if (options[key] == null) options[key] = v;
		else if (Array.isArray(options[key])) (options[key] as string[]).push(v);
		else options[key] = [options[key] as string, v];
	};

	for (let i = 2; i < args.length; i++) {
		const token = args[i];
		if (token.startsWith("--")) {
			const eqIdx = token.indexOf("=");
			if (eqIdx !== -1) {
				addOpt(token.slice(2, eqIdx), token.slice(eqIdx + 1));
			} else {
				const next = args[i + 1];
				if (next && !next.startsWith("--")) {
					const key = token.slice(2);
					if (multiValueKeys.has(key)) {
						let j = i + 1;
						while (j < args.length && !args[j].startsWith("--")) {
							addOpt(key, args[j]);
							j++;
						}
						i = j - 1;
					} else {
						addOpt(key, next);
						i++;
					}
				} else {
					addOpt(token.slice(2), "true");
				}
			}
		} else {
			positionals.push(token);
		}
	}

	return { service, command, options, positionals };
}

function getOpt(options: Record<string, string | string[]>, key: string): string | undefined {
	const v = options[key];
	if (Array.isArray(v)) return v[0];
	return v as string | undefined;
}

function getOptAll(options: Record<string, string | string[]>, key: string): string[] {
	const v = options[key];
	if (Array.isArray(v)) return v;
	return v ? [v as string] : [];
}

function asText(value: string | number | boolean | undefined | null): string {
	if (value === undefined || value === null || value === "") return "None";
	if (typeof value === "boolean") return value ? "true" : "false";
	return String(value);
}

function parseFilters(raw: string | string[]): Array<{ Name: string; Values: string[] }> {
	const items = Array.isArray(raw) ? raw : [raw];
	return items.map((item) => {
		const parts = item.split(",").map((p) => p.trim());
		let name = "";
		let values: string[] = [];
		for (const p of parts) {
			if (p.startsWith("Name=")) name = p.slice(5);
			else if (p.startsWith("Values=")) values = p.slice(7).split(/\s*;\s*|\s*,\s*/).filter(Boolean);
		}
		if (name === "is-default") name = "isDefault";
		return { Name: name, Values: values };
	});
}

function parseKeyValueList(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of raw.split(",")) {
		const [k, v] = part.split("=");
		if (!k || v == null) continue;
		out[k.trim()] = v.trim();
	}
	return out;
}

function parseIpPermissions(raw: string): Array<{
	IpProtocol?: string;
	FromPort?: number;
	ToPort?: number;
	IpRanges?: Array<{ CidrIp?: string }>;
	UserIdGroupPairs?: Array<{ GroupId?: string }>;
}> {
	const proto = /IpProtocol=([^,]+)/.exec(raw)?.[1];
	const fromPort = /FromPort=([0-9]+)/.exec(raw)?.[1];
	const toPort = /ToPort=([0-9]+)/.exec(raw)?.[1];
	const cidr = /CidrIp=([0-9.\/]+)/.exec(raw)?.[1];
	const groupId = /GroupId=([a-zA-Z0-9-]+)/.exec(raw)?.[1];
	const perm: {
		IpProtocol?: string;
		FromPort?: number;
		ToPort?: number;
		IpRanges?: Array<{ CidrIp?: string }>;
		UserIdGroupPairs?: Array<{ GroupId?: string }>;
	} = {};
	if (proto) perm.IpProtocol = proto;
	if (fromPort) perm.FromPort = Number(fromPort);
	if (toPort) perm.ToPort = Number(toPort);
	if (cidr) perm.IpRanges = [{ CidrIp: cidr }];
	if (groupId) perm.UserIdGroupPairs = [{ GroupId: groupId }];
	return [perm];
}

function parseTargets(raw: string): Array<{ Id?: string; Port?: number }> {
	const kv = parseKeyValueList(raw);
	return [{
		Id: kv.Id,
		Port: kv.Port ? Number(kv.Port) : undefined,
	}];
}

function parseAction(raw: string): { Type: string; TargetGroupArn?: string; FixedResponseConfig?: any; RedirectConfig?: any } {
	const type = /Type=([^,]+)/.exec(raw)?.[1] || "forward";
	if (type === "forward") {
		const tga = /TargetGroupArn=([^,]+)/.exec(raw)?.[1];
		return { Type: "forward", TargetGroupArn: tga };
	}
	if (type === "fixed-response") {
		const cfgRaw = /FixedResponseConfig=\{([^}]+)\}/.exec(raw)?.[1] || "";
		const kv = parseKeyValueList(cfgRaw);
		return {
			Type: "fixed-response",
			FixedResponseConfig: {
				StatusCode: kv.StatusCode,
				ContentType: kv.ContentType,
				MessageBody: kv.MessageBody,
			},
		};
	}
	if (type === "redirect") {
		const cfgRaw = /RedirectConfig=\{([^}]+)\}/.exec(raw)?.[1] || "";
		const kv = parseKeyValueList(cfgRaw);
		return {
			Type: "redirect",
			RedirectConfig: {
				Protocol: kv.Protocol,
				Port: kv.Port,
				StatusCode: kv.StatusCode,
			},
		};
	}
	return { Type: type };
}

function parseConditions(raw: string): Array<{ Field?: string; HostHeaderConfig?: { Values?: string[] } }> {
	const field = /Field=([^,]+)/.exec(raw)?.[1];
	if (field === "host-header") {
		const valuesRaw = /HostHeaderConfig=\{Values=([^}]+)\}/.exec(raw)?.[1] || "";
		const values = valuesRaw.split(",").map((v) => v.trim()).filter(Boolean);
		return [{ Field: "host-header", HostHeaderConfig: { Values: values } }];
	}
	return [{ Field: field }];
}

function parseTagSpecifications(raw: string): Array<{ ResourceType: string; Tags: Array<{ Key: string; Value: string }> }> {
	const resourceType = /ResourceType=([^,]+)/.exec(raw)?.[1] || "instance";
	const tagsRaw = /Tags=\[([^\]]+)\]/.exec(raw)?.[1] || "";
	const tags: Array<{ Key: string; Value: string }> = [];
	const re = /\{Key=([^,}]+),Value=([^}]+)\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(tagsRaw))) {
		tags.push({ Key: m[1], Value: m[2] });
	}
	return [{ ResourceType: resourceType, Tags: tags }];
}

function parseBlockDeviceMappings(raw: string): Array<any> {
	const device = /DeviceName=([^,]+)/.exec(raw)?.[1];
	const ebsRaw = /Ebs=\{([^}]+)\}/.exec(raw)?.[1] || "";
	const kv = parseKeyValueList(ebsRaw);
	return [{
		DeviceName: device,
		Ebs: {
			VolumeSize: kv.VolumeSize ? Number(kv.VolumeSize) : undefined,
			VolumeType: kv.VolumeType,
			DeleteOnTermination: kv.DeleteOnTermination === "true",
		},
	}];
}

function resolveRegion(options: Record<string, string | string[]>): string {
	const region = getOpt(options, "region");
	return region || config.AWS_REGION;
}

/**
 * Runs an AWS CLI-like command using the AWS SDK (no local AWS CLI required).
 */
export async function runAWSCommand(
	args: string[],
	_ws: any,
	_stepId: string
): Promise<string> {
	const { service, command, options, positionals } = parseAwsArgs(args);
	const region = resolveRegion(options);

	switch (service) {
		case "sts": {
			if (command !== "get-caller-identity") throw new Error(`Unsupported sts command: ${command}`);
			const client = new STSClient(getAwsClientConfig(region));
			const resp = await client.send(new GetCallerIdentityCommand({}));
			const query = getOpt(options, "query");
			if (query?.includes("Account")) return asText(resp.Account);
			if (getOpt(options, "output") === "text") return asText(resp.Arn || resp.Account);
			return JSON.stringify(resp);
		}
		case "s3api": {
			const client = new S3Client(getAwsClientConfig(region));
			if (command === "head-bucket") {
				const bucket = getOpt(options, "bucket");
				if (!bucket) throw new Error("s3api head-bucket missing --bucket");
				await client.send(new HeadBucketCommand({ Bucket: bucket }));
				return "";
			}
			if (command === "create-bucket") {
				const bucket = getOpt(options, "bucket");
				if (!bucket) throw new Error("s3api create-bucket missing --bucket");
				const cfgRaw = getOpt(options, "create-bucket-configuration");
				const location = cfgRaw?.includes("LocationConstraint=") ? cfgRaw.split("LocationConstraint=")[1] : undefined;
				await client.send(new CreateBucketCommand({
					Bucket: bucket,
					...(location && location !== "us-east-1" ? { CreateBucketConfiguration: { LocationConstraint: location } } : {}),
				}));
				return "";
			}
			throw new Error(`Unsupported s3api command: ${command}`);
		}
		case "s3": {
			if (command !== "cp") throw new Error(`Unsupported s3 command: ${command}`);
			const [localPath, s3Uri] = positionals;
			if (!localPath || !s3Uri) throw new Error("s3 cp requires local path and s3://bucket/key");
			const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri);
			if (!match) throw new Error(`Invalid s3 uri: ${s3Uri}`);
			const bucket = match[1];
			const key = match[2];
			const body = fs.createReadStream(localPath);
			const client = new S3Client(getAwsClientConfig(region));
			await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
			return "";
		}
		case "ec2": {
			const client = new EC2Client(getAwsClientConfig(region));
			if (command === "describe-vpcs") {
				const filters = getOptAll(options, "filters");
				const vpcIds = getOptAll(options, "vpc-ids");
				const resp = await client.send(new DescribeVpcsCommand({
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
					...(vpcIds.length ? { VpcIds: vpcIds } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("Vpcs[0].VpcId")) return asText(resp.Vpcs?.[0]?.VpcId);
				if (query.includes("Vpcs[0].IsDefault")) return asText(resp.Vpcs?.[0]?.IsDefault ?? null);
				return JSON.stringify(resp.Vpcs ?? []);
			}
			if (command === "describe-subnets") {
				const filters = getOptAll(options, "filters");
				const resp = await client.send(new DescribeSubnetsCommand({
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("Subnets[*].{SubnetId:SubnetId,AvailabilityZone:AvailabilityZone}")) {
					const out = (resp.Subnets || []).map((s) => ({ SubnetId: s.SubnetId, AvailabilityZone: s.AvailabilityZone }));
					return JSON.stringify(out);
				}
				if (query.includes("Subnets[*].SubnetId")) {
					return (resp.Subnets || []).map((s) => s.SubnetId).filter(Boolean).join(" ");
				}
				return JSON.stringify(resp.Subnets ?? []);
			}
			if (command === "describe-availability-zones") {
				const filters = getOptAll(options, "filters");
				const resp = await client.send(new DescribeAvailabilityZonesCommand({
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("AvailabilityZones[*].ZoneName")) {
					return (resp.AvailabilityZones || []).map((z) => z.ZoneName).filter(Boolean).join(" ");
				}
				return JSON.stringify(resp.AvailabilityZones ?? []);
			}
			if (command === "create-default-subnet") {
				const az = getOpt(options, "availability-zone");
				const resp = await client.send(new CreateDefaultSubnetCommand({ AvailabilityZone: az }));
				return asText(resp.Subnet?.SubnetId);
			}
			if (command === "describe-security-groups") {
				const filters = getOptAll(options, "filters");
				const groupIds = getOptAll(options, "group-ids");
				const resp = await client.send(new DescribeSecurityGroupsCommand({
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
					...(groupIds.length ? { GroupIds: groupIds } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("SecurityGroups[0].GroupId")) return asText(resp.SecurityGroups?.[0]?.GroupId);
				if (query.includes("SecurityGroups[0].IpPermissions")) return JSON.stringify(resp.SecurityGroups?.[0]?.IpPermissions ?? []);
				return JSON.stringify(resp.SecurityGroups ?? []);
			}
			if (command === "create-security-group") {
				const groupName = getOpt(options, "group-name") || getOpt(options, "group-name");
				const description = getOpt(options, "description") || "Security group";
				const vpcId = getOpt(options, "vpc-id");
				const resp = await client.send(new CreateSecurityGroupCommand({
					GroupName: groupName,
					Description: description?.replace(/^['"]|['"]$/g, "") || "Security group",
					...(vpcId ? { VpcId: vpcId } : {}),
				}));
				return asText(resp.GroupId);
			}
			if (command === "authorize-security-group-ingress") {
				const groupId = getOpt(options, "group-id");
				const ipPermRaw = getOpt(options, "ip-permissions");
				let ipPermissions: any[] = [];
				if (ipPermRaw) ipPermissions = parseIpPermissions(ipPermRaw);
				else {
					const protocol = getOpt(options, "protocol") || "tcp";
					const port = getOpt(options, "port");
					const cidr = getOpt(options, "cidr");
					ipPermissions = [{
						IpProtocol: protocol,
						FromPort: port ? Number(port) : undefined,
						ToPort: port ? Number(port) : undefined,
						IpRanges: cidr ? [{ CidrIp: cidr }] : undefined,
					}];
				}
				await client.send(new AuthorizeSecurityGroupIngressCommand({
					GroupId: groupId,
					IpPermissions: ipPermissions,
				}));
				return "";
			}
			if (command === "describe-instances") {
				const instanceIds = getOptAll(options, "instance-ids");
				const resp = await client.send(new DescribeInstancesCommand({ InstanceIds: instanceIds }));
				const query = getOpt(options, "query") || "";
				const inst = resp.Reservations?.[0]?.Instances?.[0];
				if (query.includes("Reservations[0].Instances[0].PublicIpAddress")) return asText(inst?.PublicIpAddress);
				if (query.includes("Reservations[0].Instances[0].IamInstanceProfile.Arn")) return asText(inst?.IamInstanceProfile?.Arn);
				if (query.includes("Reservations[0].Instances[0].{PublicIp:PublicIpAddress,SubnetId:SubnetId,VpcId:VpcId,State:State.Name}")) {
					const out = {
						PublicIp: inst?.PublicIpAddress ?? null,
						SubnetId: inst?.SubnetId ?? null,
						VpcId: inst?.VpcId ?? null,
						State: inst?.State?.Name ?? null,
					};
					return JSON.stringify(out);
				}
				return JSON.stringify(resp.Reservations ?? []);
			}
			if (command === "modify-instance-attribute") {
				const instanceId = getOpt(options, "instance-id");
				const iamProfile = getOpt(options, "iam-instance-profile");
				const name = iamProfile?.startsWith("Name=") ? iamProfile.slice(5) : iamProfile;
				await client.send(new ModifyInstanceAttributeCommand({
					InstanceId: instanceId,
					IamInstanceProfile: name ? { Name: name } : undefined,
				}));
				return "";
			}
			if (command === "reboot-instances") {
				const instanceIds = getOptAll(options, "instance-ids");
				await client.send(new RebootInstancesCommand({ InstanceIds: instanceIds }));
				return "";
			}
			if (command === "terminate-instances") {
				const instanceIds = getOptAll(options, "instance-ids");
				await client.send(new TerminateInstancesCommand({ InstanceIds: instanceIds }));
				return "";
			}
			if (command === "run-instances") {
				const imageId = getOpt(options, "image-id");
				const instanceType = getOpt(options, "instance-type");
				const keyName = getOpt(options, "key-name");
				const securityGroupIds = getOptAll(options, "security-group-ids");
				const subnetId = getOpt(options, "subnet-id");
				const userDataArg = getOpt(options, "user-data");
				let userData: string | undefined;
				if (userDataArg?.startsWith("file://")) {
					const filePath = userDataArg.replace("file://", "");
					const raw = fs.readFileSync(filePath, "utf8");
					userData = Buffer.from(raw, "utf8").toString("base64");
				}
				const iamProfile = getOpt(options, "iam-instance-profile");
				const profileName = iamProfile?.startsWith("Name=") ? iamProfile.slice(5) : iamProfile;
				const blockDeviceMappings = getOpt(options, "block-device-mappings");
				const tagSpec = getOpt(options, "tag-specifications");
				const resp = await client.send(new RunInstancesCommand({
					ImageId: imageId,
					InstanceType: instanceType,
					KeyName: keyName,
					SecurityGroupIds: securityGroupIds,
					SubnetId: subnetId,
					UserData: userData,
					IamInstanceProfile: profileName ? { Name: profileName } : undefined,
					...(blockDeviceMappings ? { BlockDeviceMappings: parseBlockDeviceMappings(blockDeviceMappings) } : {}),
					...(tagSpec ? { TagSpecifications: parseTagSpecifications(tagSpec) } : {}),
					MinCount: 1,
					MaxCount: 1,
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("Instances[0].InstanceId")) return asText(resp.Instances?.[0]?.InstanceId);
				return JSON.stringify(resp);
			}
			if (command === "wait") {
				const waiter = positionals[0];
				if (waiter !== "instance-running") throw new Error(`Unsupported ec2 wait: ${waiter}`);
				const instanceIds = getOptAll(options, "instance-ids");
				await waitUntilInstanceRunning({ client, maxWaitTime: 600 }, { InstanceIds: instanceIds });
				return "";
			}
			if (command === "describe-key-pairs") {
				const names = getOptAll(options, "key-names");
				await client.send(new DescribeKeyPairsCommand({ KeyNames: names }));
				return "";
			}
			if (command === "create-key-pair") {
				const keyName = getOpt(options, "key-name");
				const resp = await client.send(new CreateKeyPairCommand({ KeyName: keyName }));
				const query = getOpt(options, "query") || "";
				if (query.includes("KeyMaterial")) return asText(resp.KeyMaterial);
				return JSON.stringify(resp);
			}
			if (command === "describe-images") {
				const owners = getOptAll(options, "owners");
				const imageIds = getOptAll(options, "image-ids");
				const filters = getOptAll(options, "filters");
				const resp = await client.send(new DescribeImagesCommand({
					...(owners.length ? { Owners: owners } : {}),
					...(imageIds.length ? { ImageIds: imageIds } : {}),
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
				}));
				const query = (getOpt(options, "query") || "").replace(/^"+|"+$/g, "");
				if (query.includes("sort_by(Images, &CreationDate)[-1].ImageId")) {
					const sorted = (resp.Images || []).slice().sort((a, b) => (a.CreationDate || "").localeCompare(b.CreationDate || ""));
					return asText(sorted[sorted.length - 1]?.ImageId);
				}
				if (query.includes("max(Images[0].BlockDeviceMappings")) {
					const mappings = resp.Images?.[0]?.BlockDeviceMappings || [];
					const max = mappings
						.map((m) => m.Ebs?.VolumeSize)
						.filter((n): n is number => typeof n === "number")
						.reduce((a, b) => Math.max(a, b), 0);
					return asText(max || null);
				}
				return JSON.stringify(resp.Images ?? []);
			}
			if (command === "describe-route-tables") {
				const filters = getOptAll(options, "filters");
				const resp = await client.send(new DescribeRouteTablesCommand({
					...(filters.length ? { Filters: parseFilters(filters) } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("RouteTables[*].Routes[?DestinationCidrBlock=='0.0.0.0/0'].[GatewayId,NatGatewayId]")) {
					const out = (resp.RouteTables || []).map((rt) =>
						(rt.Routes || [])
							.filter((r) => r.DestinationCidrBlock === "0.0.0.0/0")
							.map((r) => [r.GatewayId || null, r.NatGatewayId || null])
					);
					return JSON.stringify(out);
				}
				return JSON.stringify(resp.RouteTables ?? []);
			}
			throw new Error(`Unsupported ec2 command: ${command}`);
		}
		case "elbv2": {
			const client = new ElasticLoadBalancingV2Client(getAwsClientConfig(region));
			if (command === "describe-load-balancers") {
				const names = getOptAll(options, "names");
				const arns = getOptAll(options, "load-balancer-arns");
				const resp = await client.send(new DescribeLoadBalancersCommand({
					...(names.length ? { Names: names } : {}),
					...(arns.length ? { LoadBalancerArns: arns } : {}),
				}));
				const lb = resp.LoadBalancers?.[0];
				const query = getOpt(options, "query") || "";
				if (query.includes("LoadBalancers[0].LoadBalancerArn")) return asText(lb?.LoadBalancerArn);
				if (query.includes("LoadBalancers[0].DNSName")) return asText(lb?.DNSName);
				return JSON.stringify(resp.LoadBalancers ?? []);
			}
			if (command === "create-load-balancer") {
				const name = getOpt(options, "name");
				const type = getOpt(options, "type") as "application" | "network" | "gateway" | undefined;
				const scheme = getOpt(options, "scheme") as "internet-facing" | "internal" | undefined;
				const subnets = getOptAll(options, "subnets");
				const securityGroups = getOptAll(options, "security-groups");
				const resp = await client.send(new CreateLoadBalancerCommand({
					Name: name,
					Type: type,
					Scheme: scheme,
					Subnets: subnets,
					SecurityGroups: securityGroups,
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("LoadBalancers[0].LoadBalancerArn")) return asText(resp.LoadBalancers?.[0]?.LoadBalancerArn);
				return JSON.stringify(resp);
			}
			if (command === "describe-target-groups") {
				const names = getOptAll(options, "names");
				const resp = await client.send(new DescribeTargetGroupsCommand({ Names: names }));
				const query = getOpt(options, "query") || "";
				if (query.includes("TargetGroups[0].TargetGroupArn")) return asText(resp.TargetGroups?.[0]?.TargetGroupArn);
				return JSON.stringify(resp.TargetGroups ?? []);
			}
			if (command === "create-target-group") {
				const name = getOpt(options, "name");
				const protocol = getOpt(options, "protocol") as "HTTP" | "HTTPS" | "TCP" | undefined;
				const port = getOpt(options, "port");
				const targetType = getOpt(options, "target-type") as "ip" | "instance" | "lambda" | undefined;
				const vpcId = getOpt(options, "vpc-id");
				const healthCheckProtocol = getOpt(options, "health-check-protocol") as "HTTP" | "HTTPS" | undefined;
				const healthCheckPath = getOpt(options, "health-check-path");
				const resp = await client.send(new CreateTargetGroupCommand({
					Name: name,
					Protocol: protocol,
					Port: port ? Number(port) : undefined,
					TargetType: targetType,
					VpcId: vpcId,
					HealthCheckProtocol: healthCheckProtocol,
					HealthCheckPath: healthCheckPath,
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("TargetGroups[0].TargetGroupArn")) return asText(resp.TargetGroups?.[0]?.TargetGroupArn);
				return JSON.stringify(resp);
			}
			if (command === "describe-listeners") {
				const lbArn = getOpt(options, "load-balancer-arn");
				const resp = await client.send(new DescribeListenersCommand({ LoadBalancerArn: lbArn }));
				return JSON.stringify(resp);
			}
			if (command === "modify-listener") {
				const listenerArn = getOpt(options, "listener-arn");
				const actionsRaw = getOpt(options, "default-actions");
				const actions = actionsRaw ? [parseAction(actionsRaw)] : [];
				await client.send(new ModifyListenerCommand({
					ListenerArn: listenerArn,
					DefaultActions: actions,
				}));
				return "";
			}
			if (command === "create-listener") {
				const lbArn = getOpt(options, "load-balancer-arn");
				const protocol = getOpt(options, "protocol") as "HTTP" | "HTTPS" | undefined;
				const port = getOpt(options, "port");
				const cert = getOpt(options, "certificates");
				const actionsRaw = getOpt(options, "default-actions");
				const actions = actionsRaw ? [parseAction(actionsRaw)] : [];
				const certArn = cert?.startsWith("CertificateArn=") ? cert.slice("CertificateArn=".length) : cert;
				const resp = await client.send(new CreateListenerCommand({
					LoadBalancerArn: lbArn,
					Protocol: protocol,
					Port: port ? Number(port) : undefined,
					DefaultActions: actions,
					...(certArn ? { Certificates: [{ CertificateArn: certArn }] } : {}),
				}));
				const query = getOpt(options, "query") || "";
				if (query.includes("Listeners[0].ListenerArn")) return asText(resp.Listeners?.[0]?.ListenerArn);
				return JSON.stringify(resp);
			}
			if (command === "describe-rules") {
				const listenerArn = getOpt(options, "listener-arn");
				const resp = await client.send(new DescribeRulesCommand({ ListenerArn: listenerArn }));
				return JSON.stringify(resp);
			}
			if (command === "modify-rule") {
				const ruleArn = getOpt(options, "rule-arn");
				const actionsRaw = getOpt(options, "actions");
				const actions = actionsRaw ? [parseAction(actionsRaw)] : [];
				await client.send(new ModifyRuleCommand({ RuleArn: ruleArn, Actions: actions }));
				return "";
			}
			if (command === "create-rule") {
				const listenerArn = getOpt(options, "listener-arn");
				const priority = getOpt(options, "priority");
				const conditionsRaw = getOpt(options, "conditions") || "";
				const actionsRaw = getOpt(options, "actions") || "";
				const resp = await client.send(new CreateRuleCommand({
					ListenerArn: listenerArn,
					Priority: priority ? Number(priority) : undefined,
					Conditions: parseConditions(conditionsRaw),
					Actions: [parseAction(actionsRaw)],
				}));
				return JSON.stringify(resp);
			}
			if (command === "register-targets") {
				const tgArn = getOpt(options, "target-group-arn");
				const targetsRaw = getOpt(options, "targets") || "";
				await client.send(new RegisterTargetsCommand({
					TargetGroupArn: tgArn,
					Targets: parseTargets(targetsRaw),
				}));
				return "";
			}
			if (command === "deregister-targets") {
				const tgArn = getOpt(options, "target-group-arn");
				const targetsRaw = getOpt(options, "targets") || "";
				await client.send(new DeregisterTargetsCommand({
					TargetGroupArn: tgArn,
					Targets: parseTargets(targetsRaw),
				}));
				return "";
			}
			if (command === "delete-rule") {
				const ruleArn = getOpt(options, "rule-arn");
				await client.send(new DeleteRuleCommand({ RuleArn: ruleArn }));
				return "";
			}
			throw new Error(`Unsupported elbv2 command: ${command}`);
		}
		case "iam": {
			const client = new IAMClient(getAwsClientConfig(region));
			if (command === "get-instance-profile") {
				const name = getOpt(options, "instance-profile-name");
				await client.send(new GetInstanceProfileCommand({ InstanceProfileName: name }));
				return "";
			}
			if (command === "create-role") {
				const roleName = getOpt(options, "role-name");
				const policyDoc = getOpt(options, "assume-role-policy-document") || "";
				let policyJson = policyDoc;
				if (policyDoc.startsWith("file://")) {
					const filePath = policyDoc.replace("file://", "");
					policyJson = fs.readFileSync(filePath, "utf8");
				}
				await client.send(new CreateRoleCommand({
					RoleName: roleName,
					AssumeRolePolicyDocument: policyJson,
				}));
				return "";
			}
			if (command === "attach-role-policy") {
				const roleName = getOpt(options, "role-name");
				const policyArn = getOpt(options, "policy-arn");
				await client.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: policyArn }));
				return "";
			}
			if (command === "create-instance-profile") {
				const name = getOpt(options, "instance-profile-name");
				await client.send(new CreateInstanceProfileCommand({ InstanceProfileName: name }));
				return "";
			}
			if (command === "add-role-to-instance-profile") {
				const profile = getOpt(options, "instance-profile-name");
				const roleName = getOpt(options, "role-name");
				await client.send(new AddRoleToInstanceProfileCommand({ InstanceProfileName: profile, RoleName: roleName }));
				return "";
			}
			throw new Error(`Unsupported iam command: ${command}`);
		}
		case "ssm": {
			const client = new SSMClient(getAwsClientConfig(region));
			if (command === "describe-instance-information") {
				const filtersRaw = getOptAll(options, "filters");
				const filters = filtersRaw.map((f) => {
					const kv = parseKeyValueList(f);
					const key = kv.Key || kv.key;
					const values = kv.Values ? kv.Values.split(/\s*,\s*/).filter(Boolean) : [];
					return { Key: key, Values: values };
				});
				const resp = await client.send(new DescribeInstanceInformationCommand({ Filters: filters }));
				const query = getOpt(options, "query") || "";
				if (query.includes("InstanceInformationList[0].InstanceId")) {
					return asText(resp.InstanceInformationList?.[0]?.InstanceId);
				}
				return JSON.stringify(resp.InstanceInformationList ?? []);
			}
			throw new Error(`Unsupported ssm command: ${command}`);
		}
		case "rds": {
			const client = new RDSClient(getAwsClientConfig(region));
			if (command === "describe-db-subnet-groups") {
				const name = getOpt(options, "db-subnet-group-name");
				await client.send(new DescribeDBSubnetGroupsCommand({ DBSubnetGroupName: name }));
				return "";
			}
			if (command === "create-db-subnet-group") {
				const name = getOpt(options, "db-subnet-group-name");
				const desc = getOpt(options, "db-subnet-group-description") || "DB subnet group";
				const subnetIds = getOptAll(options, "subnet-ids");
				await client.send(new CreateDBSubnetGroupCommand({
					DBSubnetGroupName: name,
					DBSubnetGroupDescription: desc,
					SubnetIds: subnetIds,
				}));
				return "";
			}
			if (command === "describe-db-instances") {
				const id = getOpt(options, "db-instance-identifier");
				const resp = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
				const inst = resp.DBInstances?.[0];
				const query = getOpt(options, "query") || "";
				if (query.includes("DBInstances[0].Endpoint.Address")) return asText(inst?.Endpoint?.Address);
				if (query.includes("DBInstances[0].[DBInstanceStatus,Endpoint.Address]")) {
					return `${inst?.DBInstanceStatus || "None"} ${inst?.Endpoint?.Address || "None"}`.trim();
				}
				return JSON.stringify(resp.DBInstances ?? []);
			}
			if (command === "create-db-instance") {
				const id = getOpt(options, "db-instance-identifier");
				const cls = getOpt(options, "db-instance-class");
				const engine = getOpt(options, "engine");
				const masterUsername = getOpt(options, "master-username");
				const masterPassword = getOpt(options, "master-user-password");
				const allocatedStorage = getOpt(options, "allocated-storage");
				const sgIds = getOptAll(options, "vpc-security-group-ids");
				const subnetGroup = getOpt(options, "db-subnet-group-name");
				const publiclyAccessible = Boolean(getOpt(options, "publicly-accessible"));
				const backupRetention = getOpt(options, "backup-retention-period");
				const dbName = getOpt(options, "db-name");
				await client.send(new CreateDBInstanceCommand({
					DBInstanceIdentifier: id,
					DBInstanceClass: cls,
					Engine: engine,
					MasterUsername: masterUsername,
					MasterUserPassword: masterPassword,
					AllocatedStorage: allocatedStorage ? Number(allocatedStorage) : undefined,
					VpcSecurityGroupIds: sgIds,
					DBSubnetGroupName: subnetGroup,
					PubliclyAccessible: publiclyAccessible,
					BackupRetentionPeriod: backupRetention ? Number(backupRetention) : undefined,
					...(dbName ? { DBName: dbName } : {}),
				}));
				return "";
			}
			if (command === "delete-db-instance") {
				const id = getOpt(options, "db-instance-identifier");
				const skipFinalSnapshot = !!getOpt(options, "skip-final-snapshot");
				await client.send(new DeleteDBInstanceCommand({
					DBInstanceIdentifier: id,
					SkipFinalSnapshot: skipFinalSnapshot,
				}));
				return "";
			}
			throw new Error(`Unsupported rds command: ${command}`);
		}
		default:
			throw new Error(`Unsupported AWS service: ${service}`);
	}
}

/**
 * Creates an S3 bucket if it doesn't exist
 */
export async function ensureS3Bucket(
	bucketName: string,
	region: string,
	ws: any
): Promise<void> {
	const send = createWebSocketLogger(ws);

	try {
		// Check if bucket exists
		await runAWSCommand([
			"s3api", "head-bucket",
			"--bucket", bucketName
		], ws, 'setup');
		send(`S3 bucket ${bucketName} already exists`, 'setup');
	} catch {
		// Create bucket
		send(`Creating S3 bucket: ${bucketName}...`, 'setup');
		const createArgs = [
			"s3api", "create-bucket",
			"--bucket", bucketName
		];

		// LocationConstraint is required for regions other than us-east-1
		if (region !== 'us-east-1') {
			createArgs.push("--create-bucket-configuration", `LocationConstraint=${region}`);
		}

		await runAWSCommand(createArgs, ws, 'setup');
		send(`S3 bucket ${bucketName} created`, 'setup');
	}
}

/**
 * Uploads a file to S3
 */
export async function uploadToS3(
	localPath: string,
	bucketName: string,
	s3Key: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	send(`Uploading to S3: s3://${bucketName}/${s3Key}...`, 'upload');

	await runAWSCommand([
		"s3", "cp",
		localPath,
		`s3://${bucketName}/${s3Key}`
	], ws, 'upload');

	send(`Upload complete: s3://${bucketName}/${s3Key}`, 'upload');
	return `s3://${bucketName}/${s3Key}`;
}

/**
 * Creates a ZIP file of a directory using Unix-style path separators (/) in the archive.
 * Required so Elastic Beanstalk's Linux unzip succeeds; Windows Compress-Archive uses backslashes and fails.
 */
export async function createZipBundle(
	sourceDir: string,
	outputPath: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	send(`Creating deployment bundle...`, 'bundle');

	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(outputPath);
		const archive = archiver("zip", { zlib: { level: 6 } });

		out.on("close", () => resolve());
		archive.on("error", (err: Error) => reject(err));
		out.on("error", (err: Error) => reject(err));

		archive.pipe(out);
		// false = directory contents at archive root; archiver uses forward slashes so Linux unzip works
		archive.directory(sourceDir, false, (entry: { name: string }) => {
			// Exclude node_modules, .git, .next; EB runs npm install and npm run build on the instance
			const n = entry.name.replace(/\\/g, "/");
			if (/^(node_modules|\.git|\.next)(\/|$)/.test(n)) return false;
			return entry;
		});
		archive.finalize();
	});

	send(`✅ Deployment bundle created: ${outputPath}`, 'bundle');
	return outputPath;
}

/**
 * Gets the default VPC ID
 */
export async function getDefaultVpcId(ws: any): Promise<string> {
	const output = await runAWSCommand([
		"ec2", "describe-vpcs",
		"--filters", "Name=is-default,Values=true",
		"--query", "Vpcs[0].VpcId",
		"--output", "text"
	], ws, 'setup');

	return output.trim();
}

/**
 * Gets subnet IDs for a VPC
 */
export async function getSubnetIds(vpcId: string, ws: any): Promise<string[]> {
	const send = createWebSocketLogger(ws);
	const listSubnets = async (): Promise<Array<{ SubnetId?: string; AvailabilityZone?: string }>> => {
		const output = await runAWSCommand([
			"ec2", "describe-subnets",
			"--filters", `Name=vpc-id,Values=${vpcId}`,
			"--query", "Subnets[*].{SubnetId:SubnetId,AvailabilityZone:AvailabilityZone}",
			"--output", "json"
		], ws, 'setup');
		try {
			const parsed = JSON.parse(output);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	};

	const toDistinctAzSubnetIds = (subnets: Array<{ SubnetId?: string; AvailabilityZone?: string }>): string[] => {
		const byAz = new Map<string, string>();
		for (const subnet of subnets) {
			const id = subnet.SubnetId?.trim();
			const az = subnet.AvailabilityZone?.trim();
			if (!id || !az || byAz.has(az)) continue;
			byAz.set(az, id);
		}
		return Array.from(byAz.values());
	};

	let subnets = await listSubnets();
	let subnetIds = toDistinctAzSubnetIds(subnets);
	if (subnetIds.length >= 2) {
		return subnetIds;
	}

	const isDefaultVpcOutput = await runAWSCommand([
		"ec2", "describe-vpcs",
		"--vpc-ids", vpcId,
		"--query", "Vpcs[0].IsDefault",
		"--output", "text"
	], ws, "setup");
	const isDefaultVpc = isDefaultVpcOutput.trim().toLowerCase() === "true";

	if (!isDefaultVpc) {
		send(`Only ${subnetIds.length} subnet AZ found in VPC ${vpcId}. Using existing subnets (cannot auto-create in non-default VPC).`, "setup");
		const fallback = subnets
			.map((s) => s.SubnetId?.trim())
			.filter((id): id is string => Boolean(id));
		return fallback;
	}

	const availableAzOutput = await runAWSCommand([
		"ec2", "describe-availability-zones",
		"--filters", "Name=state,Values=available",
		"--query", "AvailabilityZones[*].ZoneName",
		"--output", "text"
	], ws, "setup");
	const azs = availableAzOutput.trim().split(/\s+/).filter(Boolean);
	const existingAzs = new Set(
		subnets
			.map((s) => s.AvailabilityZone?.trim())
			.filter((az): az is string => Boolean(az))
	);

	for (const az of azs) {
		if (subnetIds.length >= 2) break;
		if (existingAzs.has(az)) continue;
		try {
			send(`Creating default subnet in ${az} for ALB multi-AZ support...`, "setup");
			await runAWSCommand([
				"ec2", "create-default-subnet",
				"--availability-zone", az,
				"--output", "text"
			], ws, "setup");
			existingAzs.add(az);
		} catch {
			// subnet may already exist or AZ may be restricted; continue
		}
		subnets = await listSubnets();
		subnetIds = toDistinctAzSubnetIds(subnets);
	}

	if (subnetIds.length < 2) {
		send(`Could not ensure two AZ subnets in VPC ${vpcId}. Continuing with available subnet(s).`, "setup");
	}

	if (subnetIds.length > 0) {
		return subnetIds;
	}

	const fallbackOutput = await runAWSCommand([
		"ec2", "describe-subnets",
		"--filters", `Name=vpc-id,Values=${vpcId}`,
		"--query", "Subnets[*].SubnetId",
		"--output", "text"
	], ws, "setup");
	return fallbackOutput.trim().split(/\s+/).filter(Boolean);
}

/**
 * Gets or creates a security group
 */
export async function ensureSecurityGroup(
	groupName: string,
	vpcId: string,
	description: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	try {
		// Check if security group exists
		const output = await runAWSCommand([
			"ec2", "describe-security-groups",
			"--filters", `Name=group-name,Values=${groupName}`, `Name=vpc-id,Values=${vpcId}`,
			"--query", "SecurityGroups[0].GroupId",
			"--output", "text"
		], ws, 'setup');

		const groupId = output.trim();
		if (groupId && groupId !== 'None') {
			send(`Security group ${groupName} already exists: ${groupId}`, 'setup');
			return groupId;
		}
	} catch {
		// Security group doesn't exist, create it
	}

	// Create security group (key=value with quoted description avoids shell splitting on Windows)
	const quotedDesc = process.platform === 'win32'
		? `"${description.replace(/"/g, '""')}"`
		: `'${description.replace(/'/g, "'\\''")}'`;
	send(`Creating security group: ${groupName}...`, 'setup');
	const createOutput = await runAWSCommand([
		"ec2", "create-security-group",
		`--group-name=${groupName}`,
		`--description=${quotedDesc}`,
		`--vpc-id=${vpcId}`,
		"--query", "GroupId",
		"--output", "text"
	], ws, 'setup');

	const groupId = createOutput.trim();

	// Add inbound rules for HTTP and HTTPS
	await runAWSCommand([
		"ec2", "authorize-security-group-ingress",
		"--group-id", groupId,
		"--protocol", "tcp",
		"--port", "80",
		"--cidr", "0.0.0.0/0"
	], ws, 'setup');

	await runAWSCommand([
		"ec2", "authorize-security-group-ingress",
		"--group-id", groupId,
		"--protocol", "tcp",
		"--port", "443",
		"--cidr", "0.0.0.0/0"
	], ws, 'setup');

	send(`Security group created: ${groupId}`, 'setup');
	return groupId;
}

/**
 * Generates a stable resource name from repo name and optional suffix.
 * Uniqueness for deploy artifacts (e.g. S3 zip) comes from version label, not this name.
 */
export function generateResourceName(repoName: string, suffix?: string): string {
	const timestamp = Date.now().toString(36);
	const cleanName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20);
	return suffix ? `${cleanName}-${suffix}-${timestamp}` : `${cleanName}-${timestamp}`;
}

/**
 * Waits for a resource to reach a specific state
 */
export async function waitForResource(
	checkCommand: string[],
	expectedValue: string,
	maxAttempts: number = 60,
	delaySeconds: number = 10,
	ws: any
): Promise<boolean> {
	const send = createWebSocketLogger(ws);

	for (let i = 0; i < maxAttempts; i++) {
		try {
			const output = await runAWSCommand(checkCommand, ws, 'wait');
			if (output.trim().includes(expectedValue)) {
				return true;
			}
		} catch {
			// Continue waiting
		}

		send(`Waiting for resource... (${i + 1}/${maxAttempts})`, 'wait');
		await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
	}

	return false;
}

function getDeploymentBaseDomain(): string {
	const domain = (
		process.env.VERCEL_DOMAIN ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
		""
	).trim();
	if (!domain) return "";
	return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function sanitizeSubdomain(value: string): string {
	const out = value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

export function buildServiceHostname(serviceName: string, preferredSubdomain?: string): string | null {
	const baseDomain = getDeploymentBaseDomain();
	if (!baseDomain) return null;
	const label = sanitizeSubdomain(preferredSubdomain?.trim() || serviceName);
	return `${label}.${baseDomain}`;
}

export async function getAccountId(ws: any): Promise<string> {
	const output = await runAWSCommand([
		"sts", "get-caller-identity",
		"--query", "Account",
		"--output", "text"
	], ws, "auth");
	return output.trim();
}

export async function ensureAlbSecurityGroup(
	albSgName: string,
	vpcId: string,
	ws: any
): Promise<string> {
	const sgId = await ensureSecurityGroup(
		albSgName,
		vpcId,
		`Security group for ALB ${albSgName}`,
		ws
	);

	for (const port of [80, 443]) {
		try {
			await runAWSCommand([
				"ec2",
				"authorize-security-group-ingress",
				"--group-id",
				sgId,
				"--ip-permissions",
				`IpProtocol=tcp,FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=0.0.0.0/0}]`,
			], ws, "setup");
		} catch {
			// likely already exists
		}
	}
	return sgId;
}

export async function allowAlbToReachService(
	serviceSgId: string,
	albSgId: string,
	containerPort: number,
	ws: any
): Promise<void> {
	try {
		await runAWSCommand([
			"ec2",
			"authorize-security-group-ingress",
			"--group-id",
			serviceSgId,
			"--ip-permissions",
			`IpProtocol=tcp,FromPort=${containerPort},ToPort=${containerPort},UserIdGroupPairs=[{GroupId=${albSgId}}]`,
		], ws, "setup");
	} catch {
		// likely already exists
	}
}

async function ensureAlb(
	albName: string,
	subnetIds: string[],
	albSgId: string,
	region: string,
	ws: any
): Promise<{ albArn: string; dnsName: string }> {
	try {
		const albArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].LoadBalancerArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		const dnsName = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].DNSName",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (albArn && albArn !== "None") return { albArn, dnsName };
	} catch {
		// does not exist
	}

	const albArn = (
		await runAWSCommand(
			[
				"elbv2",
				"create-load-balancer",
				"--name",
				albName,
				"--type",
				"application",
				"--scheme",
				"internet-facing",
				"--subnets",
				...subnetIds,
				"--security-groups",
				albSgId,
				"--query",
				"LoadBalancers[0].LoadBalancerArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	const dnsName = (
		await runAWSCommand(
			[
				"elbv2",
				"describe-load-balancers",
				"--load-balancer-arns",
				albArn,
				"--query",
				"LoadBalancers[0].DNSName",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	return { albArn, dnsName };
}

export async function ensureTargetGroup(
	tgName: string,
	vpcId: string,
	containerPort: number,
	region: string,
	ws: any,
	opts?: { targetType?: "ip" | "instance"; healthCheckPath?: string }
): Promise<string> {
	try {
		const tgArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-target-groups",
					"--names",
					tgName,
					"--query",
					"TargetGroups[0].TargetGroupArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (tgArn && tgArn !== "None") return tgArn;
	} catch {
		// does not exist
	}

	const targetType = opts?.targetType || "ip";
	const healthCheckPath = opts?.healthCheckPath || "/";

	return (
		await runAWSCommand(
			[
				"elbv2",
				"create-target-group",
				"--name",
				tgName,
				"--protocol",
				"HTTP",
				"--port",
				String(containerPort),
				"--target-type",
				targetType,
				"--vpc-id",
				vpcId,
				"--health-check-protocol",
				"HTTP",
				"--health-check-path",
				healthCheckPath,
				"--query",
				"TargetGroups[0].TargetGroupArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();
}

async function ensureHttpListener(
	albArn: string,
	region: string,
	ws: any,
	opts?: { redirectToHttps?: boolean }
): Promise<string> {
	const redirectToHttps = opts?.redirectToHttps ?? false;
	try {
		const raw = await runAWSCommand(
			[
				"elbv2",
				"describe-listeners",
				"--load-balancer-arn",
				albArn,
				"--output",
				"json",
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		const listeners = JSON.parse(raw).Listeners || [];
		const listener = listeners.find((l: any) => l.Port === 80);
		if (listener?.ListenerArn) {
			const listenerArn = listener.ListenerArn;
			if (redirectToHttps) {
				await runAWSCommand(
					[
						"elbv2",
						"modify-listener",
						"--listener-arn",
						listenerArn,
						"--default-actions",
						"Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}",
						"--region",
						region,
					],
					ws,
					"deploy"
				);
			}
			return listenerArn;
		}
	} catch (e: any) {
		// ignore
	}

	const defaultAction = redirectToHttps
		? "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"
		: "Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=NotFound}";

	try {
		const createdArn = (
			await runAWSCommand(
				[
					"elbv2",
					"create-listener",
					"--load-balancer-arn",
					albArn,
					"--protocol",
					"HTTP",
					"--port",
					"80",
					"--default-actions",
					defaultAction,
					"--query",
					"Listeners[0].ListenerArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();

		return createdArn;
	} catch (e: any) {
		if (e.message?.includes("DuplicateListener")) {
			const raw = await runAWSCommand(["elbv2", "describe-listeners", "--load-balancer-arn", albArn, "--output", "json", "--region", region], ws, "deploy");
			const listeners = JSON.parse(raw).Listeners || [];
			const listener = listeners.find((l: any) => l.Port === 80);
			if (listener?.ListenerArn) return listener.ListenerArn;
		}
		throw e;
	}
}

async function ensureHttpsListener(
	albArn: string,
	certificateArn: string,
	region: string,
	ws: any
): Promise<string> {
	try {
		const raw = await runAWSCommand(
			[
				"elbv2",
				"describe-listeners",
				"--load-balancer-arn",
				albArn,
				"--output",
				"json",
				"--region",
				region,
			],
			ws,
			"deploy"
		);
		const listeners = JSON.parse(raw).Listeners || [];
		const listener = listeners.find((l: any) => l.Port === 443);
		if (listener?.ListenerArn) {
			return listener.ListenerArn;
		}
	} catch (e: any) {
		// ignore
	}

	try {
		const createdArn = (
			await runAWSCommand(
				[
					"elbv2",
					"create-listener",
					"--load-balancer-arn",
					albArn,
					"--protocol",
					"HTTPS",
					"--port",
					"443",
					"--certificates",
					`CertificateArn=${certificateArn}`,
					"--default-actions",
					"Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=NotFound}",
					"--query",
					"Listeners[0].ListenerArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();

		return createdArn;
	} catch (e: any) {
		if (e.message?.includes("DuplicateListener")) {
			const raw = await runAWSCommand(["elbv2", "describe-listeners", "--load-balancer-arn", albArn, "--output", "json", "--region", region], ws, "deploy");
			const listeners = JSON.parse(raw).Listeners || [];
			const listener = listeners.find((l: any) => l.Port === 443);
			if (listener?.ListenerArn) return listener.ListenerArn;
		}
		throw e;
	}
}

export async function ensureHostRule(
	listenerArn: string,
	hostname: string,
	targetGroupArn: string,
	region: string,
	ws: any
): Promise<void> {
	const rulesRaw = await runAWSCommand([
		"elbv2",
		"describe-rules",
		"--listener-arn",
		listenerArn,
		"--output",
		"json",
		"--region",
		region,
	], ws, "deploy");

	let rules: Array<{
		RuleArn?: string;
		Priority?: string;
		Conditions?: Array<{ Field?: string; HostHeaderConfig?: { Values?: string[] } }>;
		Actions?: Array<{ Type?: string; TargetGroupArn?: string }>;
	}> = [];
	try {
		const parsed = JSON.parse(rulesRaw);
		rules = Array.isArray(parsed?.Rules) ? parsed.Rules : [];
	} catch {
		rules = [];
	}

	const existingRule = rules.find((rule) =>
		(rule.Conditions || []).some((cond) =>
			cond.Field === "host-header" && (cond.HostHeaderConfig?.Values || []).includes(hostname)
		)
	);
	if (existingRule?.RuleArn) {
		const currentTargetGroup = (existingRule.Actions || []).find((a) => a.Type === "forward")?.TargetGroupArn;
		if (currentTargetGroup === targetGroupArn) return;
		await runAWSCommand([
			"elbv2",
			"modify-rule",
			"--rule-arn",
			existingRule.RuleArn,
			"--actions",
			`Type=forward,TargetGroupArn=${targetGroupArn}`,
			"--region",
			region,
		], ws, "deploy");
		return;
	}

	const numericPriorities = rules
		.map((r) => r.Priority)
		.filter((p): p is string => typeof p === "string" && p !== "default")
		.map((p) => Number(p))
		.filter((n) => Number.isFinite(n));

	const maxPriority = numericPriorities.length ? Math.max(...numericPriorities) : 100;
	let priority = maxPriority + 1;
	if (priority > 50000) priority = 50000;

	await runAWSCommand([
		"elbv2",
		"create-rule",
		"--listener-arn",
		listenerArn,
		"--priority",
		String(priority),
		"--conditions",
		`Field=host-header,HostHeaderConfig={Values=${hostname}}`,
		"--actions",
		`Type=forward,TargetGroupArn=${targetGroupArn}`,
		"--region",
		region,
	], ws, "deploy");
}

export async function registerInstanceToTargetGroup(
	targetGroupArn: string,
	instanceId: string,
	port: number,
	region: string,
	ws: any
): Promise<void> {
	await runAWSCommand([
		"elbv2",
		"register-targets",
		"--target-group-arn",
		targetGroupArn,
		"--targets",
		`Id=${instanceId},Port=${port}`,
		"--region",
		region,
	], ws, "deploy");
}

/**
 * When ACM is configured, the HTTP listener's default action must redirect to HTTPS.
 * Host-based *forward* rules on port 80 match before the default and would still serve plain HTTP — remove them
 * so app traffic uses TLS on 443 (host rules belong on the HTTPS listener only).
 */
async function stripForwardRulesFromListener(listenerArn: string, region: string, ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);
	let rulesRaw: string;
	try {
		rulesRaw = await runAWSCommand(
			["elbv2", "describe-rules", "--listener-arn", listenerArn, "--output", "json", "--region", region],
			ws,
			"deploy"
		);
	} catch {
		return;
	}
	let rules: Array<{ RuleArn?: string; Priority?: string; IsDefault?: boolean; Actions?: Array<{ Type?: string }> }> = [];
	try {
		rules = JSON.parse(rulesRaw).Rules || [];
	} catch {
		return;
	}
	let removed = 0;
	for (const rule of rules) {
		if (rule.IsDefault || rule.Priority === "default") continue;
		const hasForward = (rule.Actions || []).some((a) => a.Type === "forward");
		if (!hasForward || !rule.RuleArn) continue;
		try {
			await runAWSCommand(["elbv2", "delete-rule", "--rule-arn", rule.RuleArn, "--region", region], ws, "deploy");
			removed++;
		} catch {
			// already deleted or race
		}
	}
	if (removed > 0) {
		send(`Removed ${removed} legacy HTTP forward rule(s); app routes now use HTTPS (443) only.`, "deploy");
	}
}

export async function ensureSharedAlb(
	params: {
		vpcId: string;
		subnetIds: string[];
		region: string;
		ws: any;
		certificateArn?: string;
	}
): Promise<{ albArn: string; dnsName: string; albSgId: string; httpListenerArn: string; httpsListenerArn?: string }> {
	const send = createWebSocketLogger(params.ws);
	const accountId = await getAccountId(params.ws);
	const suffix = accountId ? accountId.slice(-6) : "shared";
	const albName = `smartdeploy-${suffix}-alb`.slice(0, 32);
	const albSgName = `smartdeploy-${suffix}-alb-sg`.slice(0, 255);
	const certificateArn = params.certificateArn?.trim() || "";

	send(`Ensuring shared ALB (${albName})...`, "deploy");
	const albSgId = await ensureAlbSecurityGroup(albSgName, params.vpcId, params.ws);
	const { albArn, dnsName } = await ensureAlb(albName, params.subnetIds, albSgId, params.region, params.ws);
	const httpListenerArn = await ensureHttpListener(albArn, params.region, params.ws, {
		redirectToHttps: !!certificateArn,
	});
	const httpsListenerArn = certificateArn
		? await ensureHttpsListener(albArn, certificateArn, params.region, params.ws)
		: undefined;

	if (certificateArn) {
		await stripForwardRulesFromListener(httpListenerArn, params.region, params.ws);
	}

	return { albArn, dnsName, albSgId, httpListenerArn, httpsListenerArn };
}
