import { dbHelper } from "@/db-helper";
import {
	getUptimeCreditsPerHour,
	HOSTING_CREDITS_BILLING_ENABLED,
} from "@/lib/billing/creditPricing";

export const UPTIME_BILLING_INTERVAL_MS = 60 * 60 * 1000;

export function msUntilNextHourlyTick(now = new Date()): number {
	const next = new Date(now);
	next.setUTCSeconds(0, 0);
	next.setUTCMinutes(5);
	if (next.getTime() <= now.getTime()) {
		next.setUTCHours(next.getUTCHours() + 1);
	}
	return next.getTime() - now.getTime();
}

export function formatUtcHourBucket(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hour = String(date.getUTCHours()).padStart(2, "0");
	return `${year}-${month}-${day}T${hour}`;
}

/** Bill the previous complete UTC hour (partial hours are not charged). */
export function getBillableUtcHourBucket(now = new Date()): string {
	const previousHour = new Date(now);
	previousHour.setUTCMinutes(0, 0, 0);
	previousHour.setUTCHours(previousHour.getUTCHours() - 1);
	return formatUtcHourBucket(previousHour);
}

export function buildUptimeReferenceId(deploymentId: string, hourBucket: string): string {
	return `uptime:${deploymentId}:${hourBucket}`;
}

export type UptimeBillingResult = {
	billed: number;
	skipped: number;
	insufficient: number;
	errors: number;
	hourBucket: string;
};

export async function reconcileUptimeBilling(now = new Date()): Promise<UptimeBillingResult> {
	const hourBucket = getBillableUtcHourBucket(now);
	const result: UptimeBillingResult = {
		billed: 0,
		skipped: 0,
		insufficient: 0,
		errors: 0,
		hourBucket,
	};

	if (!HOSTING_CREDITS_BILLING_ENABLED) {
		return result;
	}

	const creditsPerHour = getUptimeCreditsPerHour();
	if (creditsPerHour <= 0) {
		return result;
	}

	const listed = await dbHelper.listRunningDeploymentsForUptimeBilling();
	if (listed.error) {
		console.error("[uptime-billing] failed to list deployments:", listed.error);
		result.errors += 1;
		return result;
	}

	if (listed.deployments.length === 0) {
		console.log("[uptime-billing] no running ECS deployments to bill");
		return result;
	}

	console.log(
		`[uptime-billing] billing ${listed.deployments.length} deployment(s) for ${hourBucket} at ${creditsPerHour} credits/hr`
	);

	for (const deployment of listed.deployments) {
		const referenceId = buildUptimeReferenceId(deployment.id, hourBucket);
		const debit = await dbHelper.debitCredits({
			userId: deployment.userId,
			credits: creditsPerHour,
			referenceId,
			metadata: {
				kind: "uptime",
				deploymentId: deployment.id,
				repoName: deployment.repoName,
				serviceName: deployment.serviceName,
				hourBucket,
				creditsPerHour,
			},
		});

		if (debit.error) {
			console.error(
				`[uptime-billing] error for ${deployment.repoName}/${deployment.serviceName}:`,
				debit.error
			);
			result.errors += 1;
			continue;
		}
		if (debit.duplicate) {
			result.skipped += 1;
			continue;
		}
		if (debit.insufficientBalance) {
			console.warn(
				`[uptime-billing] insufficient credits for user ${deployment.userId} (${deployment.repoName}/${deployment.serviceName})`
			);
			result.insufficient += 1;
			continue;
		}
		if (debit.debited) {
			result.billed += 1;
		}
	}

	console.log(
		`[uptime-billing] finished ${hourBucket}: billed=${result.billed} skipped=${result.skipped} insufficient=${result.insufficient} errors=${result.errors}`
	);
	return result;
}

let uptimeBillingStarted = false;

export function startUptimeBillingReconciler(): void {
	if (uptimeBillingStarted) return;
	if (process.env.SMARTDEPLOY_DISABLE_UPTIME_BILLING === "1") {
		console.log("[uptime-billing] disabled via SMARTDEPLOY_DISABLE_UPTIME_BILLING=1");
		return;
	}
	if (!HOSTING_CREDITS_BILLING_ENABLED) {
		console.log("[uptime-billing] disabled — HOSTING_CREDITS_BILLING_ENABLED is false");
		return;
	}

	uptimeBillingStarted = true;
	const run = () => {
		void reconcileUptimeBilling().catch((error) => {
			console.error("[uptime-billing] tick failed:", error);
		});
	};

	const msUntilNextHour = msUntilNextHourlyTick();

	console.log(
		`[uptime-billing] starting; first run in ${Math.round(msUntilNextHour / 1000)}s, then every hour`
	);
	setTimeout(() => {
		run();
		setInterval(run, UPTIME_BILLING_INTERVAL_MS);
	}, msUntilNextHour);
}
