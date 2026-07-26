/**
 * SmartDeploy credit pricing — derived from AWS us-west-2 on-demand rates and
 * the resources configured in this repo (Fargate 512/1024 app tasks, 1024/2048
 * deployment worker, CodeBuild BUILD_GENERAL1_SMALL, shared ALB, ECR, S3, etc.).
 *
 * 1 credit = $0.01 USD (matches top-up packages in supabase/billing.sql).
 *
 * Customer billing uses flat competitive rates (COMPETITIVE_CUSTOMER_CREDITS).
 * Live ECS uptime is debited hourly when HOSTING_CREDITS_BILLING_ENABLED is true.
 * AWS cost estimates + AWS_MARKUP_MULTIPLIER (5%) remain for internal accounting.
 */

import config from "@/config";

/** USD value of one credit at list price (500 credits = $5). */
export const CREDIT_USD_VALUE = 0.01;

/** Multiplier applied on top of estimated AWS cost before converting to credits. */
export const AWS_MARKUP_MULTIPLIER = 1.05;

/** AWS on-demand unit prices (us-west-2, Linux/x86, 2025–2026). */
export const AWS_UNIT_PRICES_USD = {
	fargateVcpuHour: 0.04048,
	fargateGbHour: 0.004445,
	codebuildSmallMinute: 0.005,
	ecrGbMonth: 0.1,
	albFixedHour: 0.0225,
	albLcuHour: 0.008,
	cloudwatchLogIngestGb: 0.5,
	s3StandardGbMonth: 0.023,
	s3PutPer1k: 0.005,
	cloudfrontInvalidation: 0.005,
	secretsManagerSecretMonth: 0.4,
	route53HostedZoneMonth: 0.5,
	lambdaPerGbSecond: 0.0000166667,
	sqsPerMillionRequests: 0.4,
} as const;

/**
 * Defaults aligned with src/config.ts, codebuildHelpers.ts, and
 * infra/smart-deploy-platform/variables.tf.
 */
export const DEPLOY_RESOURCE_DEFAULTS = {
	region: "us-west-2",
	appCpuUnits: 512,
	appMemoryMiB: 1024,
	workerCpuUnits: 1024,
	workerMemoryMiB: 2048,
	codebuildComputeType: "BUILD_GENERAL1_SMALL" as const,
	/** Typical Railpack/Docker image build on SMALL. */
	typicalCodebuildMinutes: 8,
	/** Static site sync build is usually shorter. */
	typicalStaticCodebuildMinutes: 4,
	/** Deployment worker Fargate task lifetime for a full pipeline. */
	typicalWorkerMinutes: 10,
	/** New image pushed to ECR per fresh build. */
	typicalEcrImageGb: 0.2,
	/** Pipeline + build logs shipped to CloudWatch / S3 per run. */
	typicalDeployLogMb: 50,
	/** Used to allocate a share of the shared ALB fixed hourly cost per live service. */
	albAmortizedLiveServices: 25,
	/** Assumed ALCU-hours per live service per hour (low-traffic default). */
	albLcuHoursPerServiceHour: 0.05,
} as const;

/** When true, live ECS services are debited hourly uptime credits. */
export const HOSTING_CREDITS_BILLING_ENABLED = true;

/** Monthly price anchors for hobby-tier competitors (USD). */
export const COMPETITOR_MONTHLY_ANCHORS_USD = {
	renderStarter: 7,
	railwayHobby: 5,
} as const;

/**
 * Flat customer-facing rates — tuned to be comparable with Render/Railway hobby tiers
 * while hosting stays included. Used for UI and future usage debits.
 */
export const COMPETITIVE_CUSTOMER_CREDITS = {
	containerDeploy: 10,
	cachedRedeploy: 5,
	staticDeploy: 8,
	scan: 5,
	agentMessage: 2,
	/** Per UTC hour for a live ECS service (512 CPU / 1 GB default). */
	uptimePerHour: 4,
} as const;

/** Typical hobby-month usage for comparison cards. */
export const HOBBY_MONTH_USAGE = {
	deploys: 8,
	scans: 4,
	uptimeHours: 730,
} as const;

export type CustomerCreditScenario = {
	id: string;
	label: string;
	totalCredits: number;
	description: string;
};

export type CustomerPricingSummary = {
	billingModel: "deploy_uptime_and_ai";
	hostingIncluded: boolean;
	hobbyMonthCredits: number;
	hobbyMonthUsd: number;
	competitorAnchorsUsd: typeof COMPETITOR_MONTHLY_ANCHORS_USD;
	rates: typeof COMPETITIVE_CUSTOMER_CREDITS;
	scenarios: CustomerCreditScenario[];
};

export type DeployTarget = "ecs" | "static_s3";

export type CreditLineItem = {
	id: string;
	label: string;
	quantity: number;
	unit: string;
	awsCostUsd: number;
	credits: number;
};

export type DeployCreditEstimate = {
	target: DeployTarget;
	totalCredits: number;
	awsCostUsd: number;
	lineItems: CreditLineItem[];
};

export type RuntimeCreditEstimate = {
	cpuUnits: number;
	memoryMiB: number;
	creditsPerHour: number;
	awsCostUsdPerHour: number;
	lineItems: CreditLineItem[];
};

export type MonthlyStorageCreditEstimate = {
	ecrGb: number;
	secretCount: number;
	totalCredits: number;
	awsCostUsd: number;
	lineItems: CreditLineItem[];
};

/** Flat rates for simple debit logic (customer-facing deploy/AI rates). */
export const CREDIT_RATES = {
	containerDeploy: COMPETITIVE_CUSTOMER_CREDITS.containerDeploy,
	cachedRedeploy: COMPETITIVE_CUSTOMER_CREDITS.cachedRedeploy,
	staticDeploy: COMPETITIVE_CUSTOMER_CREDITS.staticDeploy,
	scan: COMPETITIVE_CUSTOMER_CREDITS.scan,
	agentMessage: COMPETITIVE_CUSTOMER_CREDITS.agentMessage,
	uptimePerHour: COMPETITIVE_CUSTOMER_CREDITS.uptimePerHour,
	/** Internal AWS estimate for storage — not debited hourly yet. */
	secretsPerMonth: 43,
	ecrStoragePerGbMonth: 11,
} as const;

export function getUptimeCreditsPerHour(): number {
	if (!HOSTING_CREDITS_BILLING_ENABLED) {
		return 0;
	}
	return COMPETITIVE_CUSTOMER_CREDITS.uptimePerHour;
}

export function fargateHourlyUsd(cpuUnits: number, memoryMiB: number): number {
	const vcpu = cpuUnits / 1024;
	const memoryGb = memoryMiB / 1024;
	return vcpu * AWS_UNIT_PRICES_USD.fargateVcpuHour + memoryGb * AWS_UNIT_PRICES_USD.fargateGbHour;
}

export function usdToCredits(usd: number, applyMarkup = true): number {
	const markedUp = applyMarkup ? usd * AWS_MARKUP_MULTIPLIER : usd;
	return Math.max(1, Math.ceil(markedUp / CREDIT_USD_VALUE));
}

function lineItem(args: {
	id: string;
	label: string;
	quantity: number;
	unit: string;
	awsCostUsd: number;
}): CreditLineItem {
	return {
		...args,
		credits: usdToCredits(args.awsCostUsd),
	};
}

function orchestrationAwsCost(workerMinutes: number): number {
	const workerHours = workerMinutes / 60;
	const workerCost =
		workerHours *
		fargateHourlyUsd(
			DEPLOY_RESOURCE_DEFAULTS.workerCpuUnits,
			DEPLOY_RESOURCE_DEFAULTS.workerMemoryMiB,
		);
	const lambdaGbSeconds = 0.5 * 3;
	const lambdaCost = lambdaGbSeconds * AWS_UNIT_PRICES_USD.lambdaPerGbSecond;
	const sqsCost = AWS_UNIT_PRICES_USD.sqsPerMillionRequests / 1_000_000;
	const logGb = DEPLOY_RESOURCE_DEFAULTS.typicalDeployLogMb / 1024;
	const logCost = logGb * AWS_UNIT_PRICES_USD.cloudwatchLogIngestGb;
	return workerCost + lambdaCost + sqsCost + logCost;
}

function albDeployAwsCost(): number {
	const monthlyFixed = AWS_UNIT_PRICES_USD.albFixedHour * 24 * 30;
	const perDeployShare = monthlyFixed / (DEPLOY_RESOURCE_DEFAULTS.albAmortizedLiveServices * 30);
	return perDeployShare + AWS_UNIT_PRICES_USD.albLcuHour * 0.01;
}

function ecrPushAwsCost(imageGb: number): number {
	const monthlyStorage = imageGb * AWS_UNIT_PRICES_USD.ecrGbMonth;
	return monthlyStorage / 30;
}

export type EstimateDeployCreditsInput = {
	target: DeployTarget;
	/** When true, skips CodeBuild/ECR push (existing ECR tag reused). */
	cachedBuild: boolean;
	codebuildMinutes: number | null;
	ecrImageGb: number | null;
	workerMinutes: number | null;
	includeCloudFrontInvalidation: boolean;
};

export function estimateDeployCredits(input: EstimateDeployCreditsInput): DeployCreditEstimate {
	const workerMinutes = input.workerMinutes ?? DEPLOY_RESOURCE_DEFAULTS.typicalWorkerMinutes;
	const lineItems: CreditLineItem[] = [];

	const orchestrationUsd = orchestrationAwsCost(workerMinutes);
	lineItems.push(
		lineItem({
			id: "orchestration",
			label: "Deploy orchestration (SQS, Lambda, worker, logs)",
			quantity: 1,
			unit: "run",
			awsCostUsd: orchestrationUsd,
		}),
	);

	lineItems.push(
		lineItem({
			id: "alb",
			label: "Shared ALB (target group + host rule)",
			quantity: 1,
			unit: "run",
			awsCostUsd: albDeployAwsCost(),
		}),
	);

	if (!input.cachedBuild) {
		const codebuildMinutes =
			input.codebuildMinutes ??
			(input.target === "static_s3"
				? DEPLOY_RESOURCE_DEFAULTS.typicalStaticCodebuildMinutes
				: DEPLOY_RESOURCE_DEFAULTS.typicalCodebuildMinutes);
		if (codebuildMinutes > 0) {
			lineItems.push(
				lineItem({
					id: "codebuild",
					label: `CodeBuild ${DEPLOY_RESOURCE_DEFAULTS.codebuildComputeType}`,
					quantity: codebuildMinutes,
					unit: "min",
					awsCostUsd: codebuildMinutes * AWS_UNIT_PRICES_USD.codebuildSmallMinute,
				}),
			);
		}
	}

	if (input.target === "ecs" && !input.cachedBuild) {
		const imageGb = input.ecrImageGb ?? DEPLOY_RESOURCE_DEFAULTS.typicalEcrImageGb;
		lineItems.push(
			lineItem({
				id: "ecr_push",
				label: "ECR image push + storage",
				quantity: 1,
				unit: "image",
				awsCostUsd: ecrPushAwsCost(imageGb),
			}),
		);
	}

	if (input.target === "static_s3") {
		lineItems.push(
			lineItem({
				id: "s3_sync",
				label: "S3 static asset sync",
				quantity: 1,
				unit: "run",
				awsCostUsd: AWS_UNIT_PRICES_USD.s3PutPer1k / 100,
			}),
		);
		if (input.includeCloudFrontInvalidation) {
			lineItems.push(
				lineItem({
					id: "cloudfront_invalidation",
					label: "CloudFront cache invalidation",
					quantity: 1,
					unit: "path",
					awsCostUsd: AWS_UNIT_PRICES_USD.cloudfrontInvalidation,
				}),
			);
		}
	}

	const awsCostUsd = lineItems.reduce((sum, item) => sum + item.awsCostUsd, 0);
	const totalCredits = lineItems.reduce((sum, item) => sum + item.credits, 0);

	return {
		target: input.target,
		totalCredits,
		awsCostUsd,
		lineItems,
	};
}

export function estimateRuntimeCreditsPerHour(args: {
	cpuUnits: number | null;
	memoryMiB: number | null;
}): RuntimeCreditEstimate {
	const cpuUnits =
		args.cpuUnits ?? (Number.parseInt(config.ECS_TASK_CPU, 10) || DEPLOY_RESOURCE_DEFAULTS.appCpuUnits);
	const memoryMiB =
		args.memoryMiB ?? (Number.parseInt(config.ECS_TASK_MEMORY, 10) || DEPLOY_RESOURCE_DEFAULTS.appMemoryMiB);

	const fargateUsd = fargateHourlyUsd(cpuUnits, memoryMiB);
	const albShareUsd =
		(AWS_UNIT_PRICES_USD.albFixedHour / DEPLOY_RESOURCE_DEFAULTS.albAmortizedLiveServices) +
		AWS_UNIT_PRICES_USD.albLcuHour * DEPLOY_RESOURCE_DEFAULTS.albLcuHoursPerServiceHour;

	const lineItems = [
		lineItem({
			id: "fargate_runtime",
			label: `ECS Fargate (${cpuUnits} CPU / ${memoryMiB} MiB)`,
			quantity: 1,
			unit: "hr",
			awsCostUsd: fargateUsd,
		}),
		lineItem({
			id: "alb_runtime",
			label: "Shared ALB allocation",
			quantity: 1,
			unit: "hr",
			awsCostUsd: albShareUsd,
		}),
	];

	const awsCostUsdPerHour = fargateUsd + albShareUsd;
	const creditsPerHour = lineItems.reduce((sum, item) => sum + item.credits, 0);

	return {
		cpuUnits,
		memoryMiB,
		creditsPerHour,
		awsCostUsdPerHour,
		lineItems,
	};
}

export function estimateMonthlyStorageCredits(args: {
	ecrGb: number;
	secretCount: number;
}): MonthlyStorageCreditEstimate {
	const lineItems: CreditLineItem[] = [];

	if (args.ecrGb > 0) {
		lineItems.push(
			lineItem({
				id: "ecr_storage",
				label: "ECR image storage",
				quantity: args.ecrGb,
				unit: "GB-mo",
				awsCostUsd: args.ecrGb * AWS_UNIT_PRICES_USD.ecrGbMonth,
			}),
		);
	}

	if (args.secretCount > 0) {
		lineItems.push(
			lineItem({
				id: "secrets_manager",
				label: "Secrets Manager (env vars)",
				quantity: args.secretCount,
				unit: "secret-mo",
				awsCostUsd: args.secretCount * AWS_UNIT_PRICES_USD.secretsManagerSecretMonth,
			}),
		);
	}

	const awsCostUsd = lineItems.reduce((sum, item) => sum + item.awsCostUsd, 0);
	const totalCredits = lineItems.reduce((sum, item) => sum + item.credits, 0);

	return {
		ecrGb: args.ecrGb,
		secretCount: args.secretCount,
		totalCredits,
		awsCostUsd,
		lineItems,
	};
}

/** Customer-facing pricing for UI and debits. */
export function getCustomerPricingSummary(): CustomerPricingSummary {
	const uptimeHours = HOSTING_CREDITS_BILLING_ENABLED ? HOBBY_MONTH_USAGE.uptimeHours : 0;
	const hobbyMonthCredits =
		HOBBY_MONTH_USAGE.deploys * COMPETITIVE_CUSTOMER_CREDITS.containerDeploy +
		HOBBY_MONTH_USAGE.scans * COMPETITIVE_CUSTOMER_CREDITS.scan +
		uptimeHours * COMPETITIVE_CUSTOMER_CREDITS.uptimePerHour;

	return {
		billingModel: "deploy_uptime_and_ai",
		hostingIncluded: !HOSTING_CREDITS_BILLING_ENABLED,
		hobbyMonthCredits,
		hobbyMonthUsd: hobbyMonthCredits * CREDIT_USD_VALUE,
		competitorAnchorsUsd: COMPETITOR_MONTHLY_ANCHORS_USD,
		rates: COMPETITIVE_CUSTOMER_CREDITS,
		scenarios: [
			{
				id: "uptime_hour",
				label: "Live ECS uptime",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.uptimePerHour,
				description: "Per UTC hour while a container service is running",
			},
			{
				id: "container_deploy",
				label: "Container deploy",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.containerDeploy,
				description: "Full build via CodeBuild + ECR + ECS rollout",
			},
			{
				id: "cached_redeploy",
				label: "Cached redeploy",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.cachedRedeploy,
				description: "Same commit — skips CodeBuild when image exists",
			},
			{
				id: "static_deploy",
				label: "Static site deploy",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.staticDeploy,
				description: "CodeBuild → S3 (+ CloudFront invalidation)",
			},
			{
				id: "scan",
				label: "Repository scan",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.scan,
				description: "SD-artifacts analysis run",
			},
			{
				id: "agent_message",
				label: "Deployment agent turn",
				totalCredits: COMPETITIVE_CUSTOMER_CREDITS.agentMessage,
				description: "One agent request/response",
			},
		],
	};
}

/** Reference scenarios shown in the Credits UI. */
export function getCreditPricingScenarios() {
	const customer = getCustomerPricingSummary();
	const containerDeploy = estimateDeployCredits({
		target: "ecs",
		cachedBuild: false,
		codebuildMinutes: null,
		ecrImageGb: null,
		workerMinutes: null,
		includeCloudFrontInvalidation: false,
	});
	const cachedRedeploy = estimateDeployCredits({
		target: "ecs",
		cachedBuild: true,
		codebuildMinutes: 0,
		ecrImageGb: null,
		workerMinutes: null,
		includeCloudFrontInvalidation: false,
	});
	const staticDeploy = estimateDeployCredits({
		target: "static_s3",
		cachedBuild: false,
		codebuildMinutes: null,
		ecrImageGb: null,
		workerMinutes: null,
		includeCloudFrontInvalidation: true,
	});
	const runtime = estimateRuntimeCreditsPerHour({ cpuUnits: null, memoryMiB: null });
	const monthlyStorage = estimateMonthlyStorageCredits({ ecrGb: 0.5, secretCount: 1 });

	return {
		creditUsdValue: CREDIT_USD_VALUE,
		markupMultiplier: AWS_MARKUP_MULTIPLIER,
		region: DEPLOY_RESOURCE_DEFAULTS.region,
		hostingCreditsBillingEnabled: HOSTING_CREDITS_BILLING_ENABLED,
		customer,
		flatRates: CREDIT_RATES,
		awsEstimates: {
			containerDeploy,
			cachedRedeploy,
			staticDeploy,
			runtimePerHour: runtime,
			monthlyStorageExample: monthlyStorage,
		},
	};
}
