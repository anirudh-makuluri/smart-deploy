/** Default EC2 size for new instances (matches AL2023 x86_64 AMI). */
export const DEFAULT_EC2_INSTANCE_TYPE = "t3.micro";

/**
 * Hours per month used for rough “$/mo” figures (AWS-style 730h benchmark).
 * Not calendar-month exact.
 */
export const EC2_PRICING_MONTHLY_HOURS = 730;

/**
 * Approximate Linux on-demand USD/hour in **US West (Oregon), us-west-2**.
 * Source ballpark: https://aws.amazon.com/ec2/pricing/on-demand/; refresh when AWS changes list prices.
 * Does not include EBS, data transfer, or taxes; other regions differ.
 */
export const EC2_ON_DEMAND_HOURLY_USD_US_WEST_2: Record<string, number> = {
	"t3.micro": 0.0104,
	"t3.small": 0.0208,
	"t3.medium": 0.0416,
	"t3.large": 0.0832,
	"t3.xlarge": 0.1664,
	"t3a.micro": 0.0094,
	"t3a.small": 0.0188,
	"t3a.medium": 0.0376,
	"m6i.large": 0.096,
	"m6i.xlarge": 0.192,
	"c6i.large": 0.085,
	"c6i.xlarge": 0.17,
	"r6i.large": 0.126,
};

export type ApproxEc2OnDemandPrice = {
	hourlyUsd: number;
	monthlyUsd: number;
};

export function getApproxEc2OnDemandPricing(instanceType: string): ApproxEc2OnDemandPrice | null {
	const hourlyUsd = EC2_ON_DEMAND_HOURLY_USD_US_WEST_2[instanceType.trim()];
	if (hourlyUsd == null || Number.isNaN(hourlyUsd)) return null;
	return {
		hourlyUsd,
		monthlyUsd: hourlyUsd * EC2_PRICING_MONTHLY_HOURS,
	};
}

/** Short label for dropdowns (e.g. "~$0.010/hr · ~$8/mo"). */
export function formatApproxEc2PriceCompact(instanceType: string): string | null {
	const p = getApproxEc2OnDemandPricing(instanceType);
	if (!p) return null;
	return `~$${p.hourlyUsd.toFixed(3)}/hr · ~$${Math.round(p.monthlyUsd)}/mo`;
}

/** Curated x86 types. AMI selection uses x86_64; avoid Graviton (e.g. c7g) here. */
export const EC2_INSTANCE_TYPE_PRESETS = [
	"t3.micro",
	"t3.small",
	"t3.medium",
	"t3.large",
	"t3.xlarge",
	"t3a.micro",
	"t3a.small",
	"t3a.medium",
	"m6i.large",
	"m6i.xlarge",
	"c6i.large",
	"c6i.xlarge",
	"r6i.large",
] as const;

const INSTANCE_TYPE_RE = /^[a-z][a-z0-9.-]{1,39}$/i;

export function resolveEc2InstanceType(input: string | undefined | null): string {
	const t = (input ?? "").trim();
	if (!t || !INSTANCE_TYPE_RE.test(t)) return DEFAULT_EC2_INSTANCE_TYPE;
	return t;
}
