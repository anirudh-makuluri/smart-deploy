export function getDeployUrlHostname(deployUrl: string): string | null {
	const url = deployUrl.trim();
	try {
		const u = new URL(url.startsWith("http") ? url : `https://${url}`);
		return u.hostname;
	} catch {
		return null;
	}
}

export function getDeploymentBaseDomain(): string {
	const domain = (
		process.env.ROUTE53_DOMAIN ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
		""
	).trim();
	if (!domain) return "";
	return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function sanitizeSubdomain(value: string): string {
	const out = value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

export function getSubdomainFromCustomUrl(customUrl: string, baseDomain: string): string | null {
	try {
		const u = new URL(customUrl.startsWith("http") ? customUrl : `https://${customUrl}`);
		const host = u.hostname.toLowerCase();
		const base = baseDomain.toLowerCase();
		if (!host.endsWith(`.${base}`)) return null;
		const prefix = host.slice(0, -(base.length + 1));
		if (!prefix || prefix.includes(".")) return null;
		return prefix;
	} catch {
		return null;
	}
}

export function isValidIpv4(host: string): boolean {
	const parts = host.trim().split(".");
	if (parts.length !== 4) return false;
	return parts.every((p) => {
		if (!/^\d+$/.test(p)) return false;
		const n = Number(p);
		return n >= 0 && n <= 255;
	});
}

export function fqdnRecordName(host: string): string {
	const trimmed = host.trim().replace(/\.$/, "");
	return `${trimmed}.`;
}
