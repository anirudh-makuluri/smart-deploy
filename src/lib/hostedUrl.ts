import config from "@/config";

export function deploymentDomain(): string {
	return (config.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "smart-deploy.xyz").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/** Build full hosted URL from a subdomain slug. */
export function hostedUrlFromSubdomain(subdomain: string): string {
	const slug = subdomain.trim();
	return `https://${slug}.${deploymentDomain()}`;
}

/** Extract subdomain from a full hosted URL */
export function subdomainFromHostedUrl(value: string): string {
	let raw = (value ?? "").trim();
	raw = raw.replace(/^https?:\/\//, "");
	const suffix = `.${deploymentDomain()}`;
	if (raw.endsWith(suffix)) {
		const sub = raw.slice(0, -suffix.length).trim();
		return sub;
	}
	const first = raw.split(".")[0].trim();
	return first;
}

export function getDeploymentHostedUrl(deployment: {
	hostedSubdomain: string | null;
}): string | null {
	if(!deployment.hostedSubdomain) return null;
	return hostedUrlFromSubdomain(deployment.hostedSubdomain);
}

export function normalizeHostedSubdomain(value: string | null | undefined): string {
	return (value ?? "").trim();
}

function slugifyRepoNameForSubdomain(repoName: string): string {
	const out = repoName
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 58);
	return out || "app";
}

/** Default hosted subdomain for new deployments: `{repoName}{random5}`. */
export function generateDefaultHostedSubdomain(repoName: string): string {
	const base = slugifyRepoNameForSubdomain(repoName.trim());
	const suffix = Math.random().toString(36).substring(2, 7);
	return `${base}${suffix}`.slice(0, 63);
}

export function hostedSubdomainOrDefault(
	repoName: string,
	hostedSubdomain: string | null | undefined
): string {
	const trimmed = normalizeHostedSubdomain(hostedSubdomain);
	if (trimmed) return trimmed;
	if (!repoName.trim()) return "";
	return generateDefaultHostedSubdomain(repoName);
}
