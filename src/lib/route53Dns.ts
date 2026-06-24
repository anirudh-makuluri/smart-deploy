import {
	Route53Client,
	ChangeResourceRecordSetsCommand,
	ListResourceRecordSetsCommand,
	type ResourceRecordSet,
} from "@aws-sdk/client-route-53";
import config from "../config";
import { getAwsClientConfig } from "./aws/sdkClients";
import {
	fqdnRecordName,
	getDeployUrlHostname,
	getDeploymentBaseDomain,
	getSubdomainFromCustomUrl,
	isValidIpv4,
	sanitizeSubdomain,
} from "./dnsUtils";

/** Regional hosted zone IDs for Application Load Balancers (Route 53 alias targets). */
const ELB_HOSTED_ZONE_IDS: Record<string, string> = {
	"us-east-1": "Z35SXDOTRQ7X7K",
	"us-east-2": "Z3AADJGX6KTTL2",
	"us-west-1": "Z368ELLRRE2KJ0",
	"us-west-2": "Z1H1FL5HABSF5",
	"eu-west-1": "Z32O12XQLNTSW2",
	"eu-central-1": "Z215JYRZR1TBD5",
	"ap-southeast-1": "Z1LMS91P8CMLE5",
	"ap-southeast-2": "Z1GM3OXH4ZPM65",
	"ap-northeast-1": "Z14GRHDCWA56QT",
};

const CLOUDFRONT_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2";

export type AddRoute53DnsResult =
	| { success: true; deployUrl: string }
	| { success: false; error: string };

export type DeleteRoute53DnsResult =
	| { success: true; deletedCount: number }
	| { success: false; error: string };

export type AddRoute53DnsOptions = {
	deploymentTarget?: string | null;
	/** ALB DNS hostname — enables wildcard routing when ROUTE53_USE_WILDCARD is true. */
	sharedAlbDns?: string | null;
	awsRegion?: string | null;
};

export type DeleteRoute53DnsOptions = {
	customUrl?: string | null;
	serviceName?: string | null;
};

function getHostedZoneId(): string {
	return (process.env.ROUTE53_HOSTED_ZONE_ID || config.ROUTE53_HOSTED_ZONE_ID || "").trim();
}

function isWildcardDnsMode(options?: AddRoute53DnsOptions): boolean {
	const raw = (process.env.ROUTE53_USE_WILDCARD ?? config.ROUTE53_USE_WILDCARD ?? "true").trim().toLowerCase();
	if (raw === "false" || raw === "0") return false;
	return Boolean(options?.sharedAlbDns?.trim());
}

function shouldEnsureWildcard(): boolean {
	const raw = (process.env.ROUTE53_ENSURE_WILDCARD ?? config.ROUTE53_ENSURE_WILDCARD ?? "true").trim().toLowerCase();
	return raw !== "false" && raw !== "0";
}

function getElbHostedZoneId(region: string): string | null {
	return ELB_HOSTED_ZONE_IDS[region] ?? null;
}

function isCloudFrontHostname(host: string): boolean {
	return host.toLowerCase().endsWith(".cloudfront.net");
}

function isElbHostname(host: string): boolean {
	return host.toLowerCase().includes(".elb.amazonaws.com");
}

function route53Client(region?: string): Route53Client {
	return new Route53Client(getAwsClientConfig(region || config.AWS_REGION));
}

export async function ensureWildcardAlbRecord(
	albDns: string,
	region: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const zoneId = getHostedZoneId();
	const baseDomain = getDeploymentBaseDomain();
	if (!zoneId || !baseDomain) {
		return { ok: false, error: "Route 53 not configured (ROUTE53_HOSTED_ZONE_ID and deployment domain required)." };
	}

	const elbZoneId = getElbHostedZoneId(region);
	if (!elbZoneId) {
		return { ok: false, error: `No ELB hosted zone ID mapping for region ${region}` };
	}

	const albHost = albDns.trim().replace(/\.$/, "");
	const recordName = fqdnRecordName(`*.${baseDomain}`);
	const aliasDns = albHost.startsWith("dualstack.") ? albHost : `dualstack.${albHost}`;

	try {
		const client = route53Client(region);
		await client.send(
			new ChangeResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				ChangeBatch: {
					Comment: "SmartDeploy wildcard ALB alias",
					Changes: [
						{
							Action: "UPSERT",
							ResourceRecordSet: {
								Name: recordName,
								Type: "A",
								AliasTarget: {
									HostedZoneId: elbZoneId,
									DNSName: fqdnRecordName(aliasDns),
									EvaluateTargetHealth: false,
								},
							},
						},
					],
				},
			})
		);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to upsert wildcard Route 53 record";
		console.error("Route53 ensureWildcardAlbRecord error:", error);
		return { ok: false, error: message };
	}
}

function buildAliasRecord(name: string, targetHost: string, region: string): ResourceRecordSet | null {
	const host = targetHost.trim().replace(/\.$/, "");
	if (isElbHostname(host)) {
		const elbZoneId = getElbHostedZoneId(region);
		if (!elbZoneId) return null;
		const aliasDns = host.startsWith("dualstack.") ? host : `dualstack.${host}`;
		return {
			Name: fqdnRecordName(name),
			Type: "A",
			AliasTarget: {
				HostedZoneId: elbZoneId,
				DNSName: fqdnRecordName(aliasDns),
				EvaluateTargetHealth: false,
			},
		};
	}
	if (isCloudFrontHostname(host)) {
		return {
			Name: fqdnRecordName(name),
			Type: "A",
			AliasTarget: {
				HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
				DNSName: fqdnRecordName(host),
				EvaluateTargetHealth: false,
			},
		};
	}
	return null;
}

async function upsertRecord(
	recordSet: ResourceRecordSet,
	comment: string,
	region?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const zoneId = getHostedZoneId();
	if (!zoneId) {
		return { ok: false, error: "ROUTE53_HOSTED_ZONE_ID is not configured." };
	}
	try {
		const client = route53Client(region);
		await client.send(
			new ChangeResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				ChangeBatch: {
					Comment: comment,
					Changes: [{ Action: "UPSERT", ResourceRecordSet: recordSet }],
				},
			})
		);
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Route 53 UPSERT failed";
		return { ok: false, error: message };
	}
}

async function deleteRecordSet(
	recordSet: ResourceRecordSet,
	region?: string
): Promise<boolean> {
	const zoneId = getHostedZoneId();
	if (!zoneId) return false;
	try {
		const client = route53Client(region);
		await client.send(
			new ChangeResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				ChangeBatch: {
					Changes: [{ Action: "DELETE", ResourceRecordSet: recordSet }],
				},
			})
		);
		return true;
	} catch {
		return false;
	}
}

async function findExactRecord(
	subdomain: string,
	baseDomain: string,
	region?: string
): Promise<ResourceRecordSet | null> {
	const zoneId = getHostedZoneId();
	if (!zoneId) return null;
	const name = fqdnRecordName(`${subdomain}.${baseDomain}`);
	try {
		const client = route53Client(region);
		const out = await client.send(
			new ListResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				StartRecordName: name,
				StartRecordType: "A",
				MaxItems: 5,
			})
		);
		const records = out.ResourceRecordSets ?? [];
		return records.find((r) => r.Name?.toLowerCase() === name.toLowerCase()) ?? null;
	} catch {
		return null;
	}
}

/**
 * Configure deployment DNS in Route 53.
 * With wildcard mode (default for shared ALB), ensures `*.domain` → ALB and returns the custom URL.
 * Otherwise upserts a per-subdomain A/CNAME/ALIAS record.
 */
export async function addRoute53DnsRecord(
	deployUrl: string,
	hostedSubdomain: string,
	serviceName: string,
	options?: AddRoute53DnsOptions
): Promise<AddRoute53DnsResult> {
	const zoneId = getHostedZoneId();
	const baseDomain = getDeploymentBaseDomain();
	if (!zoneId || !baseDomain) {
		return {
			success: false,
			error:
				"Route 53 not configured. Set ROUTE53_HOSTED_ZONE_ID and NEXT_PUBLIC_DEPLOYMENT_DOMAIN (or ROUTE53_DOMAIN).",
		};
	}

	const region = (options?.awsRegion || config.AWS_REGION || "us-west-2").trim();
	const sharedAlbDns = options?.sharedAlbDns?.trim().replace(/\.$/, "") || "";

	if (isWildcardDnsMode(options)) {
		if (shouldEnsureWildcard() && sharedAlbDns) {
			const wildcard = await ensureWildcardAlbRecord(sharedAlbDns, region);
			if (!wildcard.ok) {
				return { success: false, error: wildcard.error };
			}
		}
		return { success: true, deployUrl };
	}

	const fqdn = `${hostedSubdomain}.${baseDomain}`;
	if (isValidIpv4(deployUrl)) {
		const result = await upsertRecord(
			{
				Name: fqdnRecordName(fqdn),
				Type: "A",
				TTL: 60,
				ResourceRecords: [{ Value: deployUrl }],
			},
			"SmartDeploy A record",
			region
		);
		if (!result.ok) return { success: false, error: result.error };
		return { success: true, deployUrl };
	}

	const aliasRecord = buildAliasRecord(fqdn, deployUrl, region);
	if (aliasRecord) {
		const result = await upsertRecord(aliasRecord, "SmartDeploy ALIAS record", region);
		if (!result.ok) return { success: false, error: result.error };
		return { success: true, deployUrl };
	}

	const result = await upsertRecord(
		{
			Name: fqdnRecordName(fqdn),
			Type: "CNAME",
			TTL: 60,
			ResourceRecords: [{ Value: fqdnRecordName(deployUrl) }],
		},
		"SmartDeploy CNAME record",
		region
	);
	if (!result.ok) return { success: false, error: result.error };
	return { success: true, deployUrl };
}

/**
 * Delete per-subdomain Route 53 record(s). No-op when wildcard mode is active (no per-service records).
 */
export async function deleteRoute53DnsRecord(
	options?: DeleteRoute53DnsOptions
): Promise<DeleteRoute53DnsResult> {
	const zoneId = getHostedZoneId();
	const baseDomain = getDeploymentBaseDomain();
	if (!zoneId || !baseDomain) {
		return {
			success: false,
			error:
				"Route 53 not configured. Set ROUTE53_HOSTED_ZONE_ID and NEXT_PUBLIC_DEPLOYMENT_DOMAIN (or ROUTE53_DOMAIN).",
		};
	}

	const wildcardDefault = (process.env.ROUTE53_USE_WILDCARD ?? config.ROUTE53_USE_WILDCARD ?? "true").trim().toLowerCase();
	if (wildcardDefault !== "false" && wildcardDefault !== "0") {
		return { success: true, deletedCount: 0 };
	}

	const customUrl = (options?.customUrl || "").trim();
	const serviceName = (options?.serviceName || "").trim();

	let subdomain: string | null = null;
	if (customUrl) {
		subdomain = getSubdomainFromCustomUrl(customUrl, baseDomain);
	}
	if (!subdomain && serviceName) {
		subdomain = sanitizeSubdomain(serviceName);
	}
	if (!subdomain) {
		return { success: false, error: "Unable to determine DNS record name to delete." };
	}

	const region = config.AWS_REGION;
	const existing =
		(await findExactRecord(subdomain, baseDomain, region)) ??
		(await (async () => {
			const name = fqdnRecordName(`${subdomain}.${baseDomain}`);
			try {
				const client = route53Client(region);
				const out = await client.send(
					new ListResourceRecordSetsCommand({
						HostedZoneId: zoneId,
						StartRecordName: name,
						StartRecordType: "CNAME",
						MaxItems: 3,
					})
				);
				return (out.ResourceRecordSets ?? []).find((r) => r.Name?.toLowerCase() === name.toLowerCase()) ?? null;
			} catch {
				return null;
			}
		})());

	if (!existing?.Name || !existing.Type) {
		return { success: true, deletedCount: 0 };
	}

	const deleted = await deleteRecordSet(existing, region);
	if (!deleted) {
		return { success: false, error: "Failed to delete Route 53 record" };
	}
	return { success: true, deletedCount: 1 };
}

export type Route53SubdomainLookup = {
	exists: boolean;
	recordType?: string;
};

/** Check whether an exact subdomain record exists (wildcard alone does not count as taken). */
export async function lookupRoute53Subdomain(
	subdomain: string,
	baseDomain?: string
): Promise<Route53SubdomainLookup> {
	const zoneId = getHostedZoneId();
	const base = baseDomain || getDeploymentBaseDomain();
	if (!zoneId || !base) {
		return { exists: false };
	}
	const sanitized = sanitizeSubdomain(subdomain);
	const aRecord = await findExactRecord(sanitized, base);
	if (aRecord) {
		return { exists: true, recordType: aRecord.Type };
	}
	const name = fqdnRecordName(`${sanitized}.${base}`);
	try {
		const client = route53Client();
		const out = await client.send(
			new ListResourceRecordSetsCommand({
				HostedZoneId: zoneId,
				StartRecordName: name,
				StartRecordType: "CNAME",
				MaxItems: 3,
			})
		);
		const cname = (out.ResourceRecordSets ?? []).find((r) => r.Name?.toLowerCase() === name.toLowerCase());
		if (cname) {
			return { exists: true, recordType: cname.Type };
		}
	} catch {
		// ignore
	}
	return { exists: false };
}

// Re-export for callers that imported from vercelDns
export { getDeployUrlHostname } from "./dnsUtils";
