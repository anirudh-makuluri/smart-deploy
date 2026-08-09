import { describe, expect, it } from "vitest";

import {
	AWS_MARKUP_MULTIPLIER,
	COMPETITIVE_CUSTOMER_CREDITS,
	CREDIT_RATES,
	CREDIT_USD_VALUE,
	DEPLOY_RESOURCE_DEFAULTS,
	HOSTING_CREDITS_BILLING_ENABLED,
	estimateDeployCredits,
	estimateMonthlyStorageCredits,
	estimateRuntimeCreditsPerHour,
	fargateHourlyUsd,
	getCreditPricingScenarios,
	getCustomerPricingSummary,
	usdToCredits,
} from "@/lib/billing/creditPricing";

describe("creditPricing", () => {
	it("matches Fargate 512/1024 hourly AWS math", () => {
		const hourly = fargateHourlyUsd(512, 1024);
		expect(hourly).toBeCloseTo(0.024685, 5);
	});

	it("applies markup when converting USD to credits", () => {
		expect(usdToCredits(0.1)).toBe(Math.ceil((0.1 * AWS_MARKUP_MULTIPLIER) / CREDIT_USD_VALUE));
	});

	it("estimates a typical container deploy above raw AWS cost", () => {
		const estimate = estimateDeployCredits({
			target: "ecs",
			cachedBuild: false,
			codebuildMinutes: DEPLOY_RESOURCE_DEFAULTS.typicalCodebuildMinutes,
			ecrImageGb: DEPLOY_RESOURCE_DEFAULTS.typicalEcrImageGb,
			workerMinutes: DEPLOY_RESOURCE_DEFAULTS.typicalWorkerMinutes,
			includeCloudFrontInvalidation: false,
		});

		expect(estimate.awsCostUsd).toBeGreaterThan(0.08);
		expect(estimate.awsCostUsd).toBeLessThan(0.2);
		expect(estimate.totalCredits).toBeGreaterThan(usdToCredits(estimate.awsCostUsd, false));
		expect(estimate.lineItems.some((item) => item.id === "codebuild")).toBe(true);
	});

	it("charges less for cached redeploys without CodeBuild", () => {
		const fresh = estimateDeployCredits({
			target: "ecs",
			cachedBuild: false,
			codebuildMinutes: 8,
			ecrImageGb: 0.2,
			workerMinutes: 10,
			includeCloudFrontInvalidation: false,
		});
		const cached = estimateDeployCredits({
			target: "ecs",
			cachedBuild: true,
			codebuildMinutes: 0,
			ecrImageGb: null,
			workerMinutes: 10,
			includeCloudFrontInvalidation: false,
		});

		expect(cached.totalCredits).toBeLessThan(fresh.totalCredits);
		expect(cached.lineItems.some((item) => item.id === "codebuild")).toBe(false);
	});

	it("includes CloudFront invalidation for static deploys", () => {
		const estimate = estimateDeployCredits({
			target: "static_s3",
			cachedBuild: false,
			codebuildMinutes: 4,
			ecrImageGb: null,
			workerMinutes: 10,
			includeCloudFrontInvalidation: true,
		});

		expect(estimate.lineItems.some((item) => item.id === "cloudfront_invalidation")).toBe(true);
	});

	it("estimates runtime above single-task Fargate cost", () => {
		const runtime = estimateRuntimeCreditsPerHour({ cpuUnits: 512, memoryMiB: 1024 });
		expect(runtime.awsCostUsdPerHour).toBeGreaterThan(0.024);
		expect(runtime.creditsPerHour).toBeGreaterThan(0);
	});

	it("estimates monthly storage for secrets and ECR", () => {
		const storage = estimateMonthlyStorageCredits({ ecrGb: 1, secretCount: 1 });
		expect(storage.awsCostUsd).toBeCloseTo(0.5, 2);
		expect(storage.totalCredits).toBeGreaterThan(50);
	});

	it("exposes customer pricing with uptime billing enabled", () => {
		const scenarios = getCreditPricingScenarios();
		expect(HOSTING_CREDITS_BILLING_ENABLED).toBe(true);
		expect(scenarios.customer.hostingIncluded).toBe(false);
		expect(scenarios.customer.rates.uptimePerHour).toBe(COMPETITIVE_CUSTOMER_CREDITS.uptimePerHour);
		expect(scenarios.flatRates.uptimePerHour).toBe(4);
		expect(scenarios.customer.hobbyMonthCredits).toBeGreaterThan(1000);
	});

	it("summarizes flat customer deploy rates", () => {
		const summary = getCustomerPricingSummary();
		expect(summary.scenarios.find((s) => s.id === "container_deploy")?.totalCredits).toBe(10);
		expect(summary.scenarios.find((s) => s.id === "cached_redeploy")?.totalCredits).toBe(5);
	});
});
