import type { DeployConfig } from "../app/types";
import { dbHelper } from "../db-helper";
import {
	findDemoRepoConfig,
	getDemoMaxActivePerUser,
	getDemoMaxDeploysPerDay,
	getDemoMaxGlobalActive,
	getDemoPrefix,
	getDemoRedeployCooldownSeconds,
	getDemoTtlMinutes,
} from "./demoMode";
import config from "../config";

const DEMO_INSTANCE_TYPE = "t3.micro";

function normalizeUrl(url?: string | null): string {
	return (url || "").trim().toLowerCase();
}

function baseDomain(): string {
	return config.VERCEL_DOMAIN || config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN;
}

export function getDemoExpiryIso(minutes = getDemoTtlMinutes()): string {
	return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function allocateDemoCustomUrl(
	repoName: string,
	serviceName: string,
	existingCustomUrl?: string | null
): Promise<string> {
	const domain = baseDomain();
	if (!domain) {
		throw new Error("Demo domains require VERCEL_DOMAIN or NEXT_PUBLIC_DEPLOYMENT_DOMAIN.");
	}

	const existing = normalizeUrl(existingCustomUrl);
	if (existing && existing.endsWith(`.${domain.toLowerCase()}`) && existing.includes(`://${getDemoPrefix()}-`)) {
		return existing;
	}

	for (let attempt = 0; attempt < 10; attempt += 1) {
		const suffix = Math.floor(100000 + Math.random() * 900000);
		const candidate = `https://${getDemoPrefix()}-${suffix}.${domain}`;
		const taken = await dbHelper.isCustomDomainTaken(candidate, { repoName, serviceName });
		if (taken.error) throw new Error(taken.error);
		if (!taken.taken) return candidate;
	}

	throw new Error("Unable to allocate a unique demo domain.");
}

export async function getDemoDeploymentDefaults(
	deployConfig: DeployConfig
): Promise<DeployConfig> {
	const demoRepo = findDemoRepoConfig({ url: deployConfig.url, repo: deployConfig.repo_name });
	if (!demoRepo) {
		throw new Error("Demo users can only deploy the curated demo repositories.");
	}

	const customUrl = await allocateDemoCustomUrl(
		deployConfig.repo_name,
		deployConfig.service_name,
		deployConfig.custom_url
	);

	return {
		...deployConfig,
		accountMode: "demo",
		cloudProvider: "aws",
		deploymentTarget: "ec2",
		awsEc2InstanceType: DEMO_INSTANCE_TYPE,
		branch: demoRepo.branch,
		commitSha: demoRepo.commitSha || deployConfig.commitSha,
		demoRepoKey: demoRepo.demoRepoKey,
		demoCommitSha: demoRepo.commitSha,
		demoLocked: true,
		custom_url: customUrl,
		scan_results: demoRepo.scan_results || deployConfig.scan_results,
	};
}

export async function assertDemoDeployLimits(
	userID: string,
	deployConfig: DeployConfig
): Promise<void> {
	const currentDeployment = await dbHelper.getDeployment(deployConfig.repo_name, deployConfig.service_name, userID);
	const isSameRunningDeployment =
		currentDeployment.deployment?.ownerID === userID &&
		currentDeployment.deployment?.status === "running";

	const userActive = await dbHelper.countActiveDemoDeployments(userID);
	if (userActive.error) throw new Error(userActive.error);
	if (!isSameRunningDeployment && (userActive.count ?? 0) >= getDemoMaxActivePerUser()) {
		throw new Error("Demo mode allows one active deployment per user at a time.");
	}

	const globalActive = await dbHelper.countActiveDemoDeployments();
	if (globalActive.error) throw new Error(globalActive.error);
	if (!isSameRunningDeployment && (globalActive.count ?? 0) >= getDemoMaxGlobalActive()) {
		throw new Error("Demo capacity is full right now. Please try again in a few minutes.");
	}

	const history = await dbHelper.getRecentDeploymentHistoryForUser(userID, 20);
	if (history.error) throw new Error(history.error);
	const timestamps = (history.timestamps || []).filter(Boolean).map((value) => new Date(value).getTime());
	const now = Date.now();
	const dayAgo = now - 24 * 60 * 60 * 1000;
	const deploysToday = timestamps.filter((value) => value >= dayAgo).length;
	if (deploysToday >= getDemoMaxDeploysPerDay()) {
		throw new Error("You have reached the demo deployment limit for today.");
	}

	const latest = timestamps[0];
	if (latest) {
		const cooldownMs = getDemoRedeployCooldownSeconds() * 1000;
		if (cooldownMs > 0 && now - latest < cooldownMs) {
			const seconds = Math.ceil((cooldownMs - (now - latest)) / 1000);
			throw new Error(`Please wait ${seconds}s before starting another demo deployment.`);
		}
	}
}
