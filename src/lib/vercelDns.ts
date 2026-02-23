const VERCEL_API_BASE = "https://api.vercel.com";

function getDeployUrlHostname(deployUrl: string): string | null {
	const url = deployUrl.trim();
	try {
		const u = new URL(url.startsWith("http") ? url : `https://${url}`);
		return u.hostname;
	} catch {
		return null;
	}
}

export type AddVercelDnsResult =
	| { success: true; customUrl: string }
	| { success: false; error: string };

export type DeleteVercelDnsResult =
	| { success: true; deletedCount: number }
	| { success: false; error: string };

export type AddVercelDnsOptions = {
	/**
	 * Used to decide whether EC2 should use an A record (IP) instead of a CNAME (hostname).
	 * If omitted, we fall back to choosing A when the deployUrl hostname is an IPv4 address.
	 */
	deploymentTarget?: string | null;
	/**
	 * If present, treat conflicts as an update for the same deployment:
	 * delete the previous record (same subdomain) and recreate it with the new target.
	 */
	previousCustomUrl?: string | null;
};

export type DeleteVercelDnsOptions = {
	customUrl?: string | null;
	serviceName?: string | null;
};

function isValidIpv4(host: string): boolean {
	const parts = host.trim().split(".");
	if (parts.length !== 4) return false;
	return parts.every((p) => {
		if (!/^\d+$/.test(p)) return false;
		const n = Number(p);
		return n >= 0 && n <= 255;
	});
}

function getSubdomainFromCustomUrl(customUrl: string, baseDomain: string): string | null {
	try {
		const u = new URL(customUrl.startsWith("http") ? customUrl : `https://${customUrl}`);
		const host = u.hostname.toLowerCase();
		const base = baseDomain.toLowerCase();
		if (!host.endsWith(`.${base}`)) return null;
		const prefix = host.slice(0, -(base.length + 1)); // remove ".baseDomain"
		// Only support a single-label subdomain (what we create)
		if (!prefix || prefix.includes(".")) return null;
		return prefix;
	} catch {
		return null;
	}
}


function sanitizeSubdomain(s: string): string {
		const out = s
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 63);
		return out || "app";
	}

/**
 * Add or update a DNS record in Vercel DNS for the given deploy URL and service name.
 * Call from backend (e.g. handleDeploy) after a successful deploy.
 * Returns success: false with error message if not configured or API fails.
 */
export async function addVercelDnsRecord(
	deployUrl: string,
	serviceName: string,
	options?: AddVercelDnsOptions
): Promise<AddVercelDnsResult> {
	const token = (process.env.VERCEL_TOKEN || "").trim();
	const domain = (
		process.env.VERCEL_DOMAIN ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
		""
	).trim();

	if (!token || !domain) {
		return {
			success: false,
			error:
				"Vercel DNS not configured. Set VERCEL_TOKEN and VERCEL_DOMAIN (or NEXT_PUBLIC_DEPLOYMENT_DOMAIN).",
		};
	}

	const trimmedUrl = typeof deployUrl === "string" ? deployUrl.trim() : "";
	const name = typeof serviceName === "string" ? serviceName : "app";
	if (!trimmedUrl) {
		return { success: false, error: "deployUrl is required" };
	}

	const targetHost = getDeployUrlHostname(trimmedUrl);
	if (!targetHost) {
		return { success: false, error: "Invalid deployUrl" };
	}

	const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
	const previousSubdomain =
		typeof options?.previousCustomUrl === "string" && options.previousCustomUrl.trim()
			? getSubdomainFromCustomUrl(options.previousCustomUrl.trim(), baseDomain)
			: null;
	const baseSubdomain = sanitizeSubdomain(name);
	const subdomain = previousSubdomain || baseSubdomain;

	// EC2 targets are commonly raw IPv4 addresses → use an A record.
	const shouldUseARecord = isValidIpv4(targetHost);
	const recordType: "A" | "CNAME" = shouldUseARecord ? "A" : "CNAME";

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	const createUrl = new URL(`${VERCEL_API_BASE}/v2/domains/${encodeURIComponent(baseDomain)}/records`);
	const listUrl = new URL(`${VERCEL_API_BASE}/v4/domains/${encodeURIComponent(baseDomain)}/records`);

	async function listRecords(): Promise<any[]> {
		const listRes = await fetch(listUrl.toString(), { headers });
		if (!listRes.ok) return [];
		const listData = await listRes.json();
		return Array.isArray(listData.records) ? listData.records : Array.isArray(listData) ? listData : [];
	}

	function recordNameMatches(r: { name?: string }, wanted: string): boolean {
		// Vercel sometimes represents apex as "" (we never use apex here, but keep parity with old code)
		return r?.name === wanted || (r?.name === "" && wanted === baseDomain);
	}

	function getRecordId(r: any): string | null {
		return (r?.id ?? r?.uid) ? String(r.id ?? r.uid) : null;
	}

	async function deleteRecordById(recordId: string): Promise<boolean> {
		const delUrl = `${VERCEL_API_BASE}/v1/domains/records/${encodeURIComponent(recordId)}`;
		const delRes = await fetch(delUrl, { method: "DELETE", headers });
		return delRes.ok;
	}

	async function createRecord(recordName: string): Promise<{ ok: true; customUrl: string } | { ok: false; status: number; errMsg: string; errBody: string }> {
		const res = await fetch(createUrl.toString(), {
			method: "POST",
			headers,
			body: JSON.stringify({
				type: recordType,
				name: recordName,
				value: targetHost,
				ttl: 60,
				comment: "SmartDeploy",
			}),
		});
		if (res.ok) {
			return { ok: true, customUrl: `https://${recordName}.${baseDomain}` };
		}
		const errBody = await res.text();
		let errJson: { error?: { message?: string } } = {};
		try {
			errJson = JSON.parse(errBody);
		} catch {
			// ignore
		}
		return {
			ok: false,
			status: res.status,
			errMsg: (errJson.error?.message || "").toLowerCase(),
			errBody,
		};
	}

	try {
		// First attempt: create record for the preferred subdomain (previousCustomUrl subdomain if present)
		const first = await createRecord(subdomain);
		if (first.ok) return { success: true, customUrl: first.customUrl };

		const isConflict =
			first.status === 400 ||
			first.status === 409 ||
			first.errMsg.includes("already exists");

		if (!isConflict) {
			return { success: false, error: "Vercel API error" };
		}

		// Conflict path:
		// - If this deployment already had a custom URL, treat as update:
		//   delete existing record(s) for that subdomain and recreate with new target.
		//   Unless the existing record already points to the same target (e.g. redeploy with same custom_url) → skip delete/recreate.
		// - Otherwise, create a unique subdomain by appending -{random} and retry.
		const records = await listRecords();

		if (previousSubdomain) {
			const existing = records.filter((r: any) => recordNameMatches(r, subdomain));
			const alreadyPointsToTarget = existing.some(
				(r: any) => (r?.value ?? "").toString().trim().toLowerCase() === targetHost.toLowerCase()
			);
			if (alreadyPointsToTarget) {
				return { success: true, customUrl: `https://${subdomain}.${baseDomain}` };
			}
			for (const r of existing) {
				const id = getRecordId(r);
				if (id) {
					await deleteRecordById(id);
				}
			}
			const recreated = await createRecord(subdomain);
			if (recreated.ok) return { success: true, customUrl: recreated.customUrl };
			return { success: false, error: "Failed to recreate DNS record after deleting the previous one" };
		}

		// New deployment + name conflict: try suffixed names
		for (let attempt = 0; attempt < 6; attempt++) {
			const rand = Math.floor(1000 + Math.random() * 9000);
			const candidate = sanitizeSubdomain(`${baseSubdomain}-${rand}`);

			// Avoid re-trying names we already have in the domain
			const alreadyTaken = records.some((r: any) => recordNameMatches(r, candidate));
			if (alreadyTaken) continue;

			const created = await createRecord(candidate);
			if (created.ok) return { success: true, customUrl: created.customUrl };
		}

		return { success: false, error: `DNS name '${baseSubdomain}' already exists; failed to find an available suffix` };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to add DNS record";
		console.error("Vercel addVercelDnsRecord error:", error);
		return { success: false, error: message };
	}
}

/**
 * Delete Vercel DNS record(s) for a deployment using its custom URL or service name.
 * Returns deletedCount=0 if no matching records exist.
 */
export async function deleteVercelDnsRecord(
	options?: DeleteVercelDnsOptions
): Promise<DeleteVercelDnsResult> {
	const token = (process.env.VERCEL_TOKEN || "").trim();
	const domain = (
		process.env.VERCEL_DOMAIN ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
		""
	).trim();

	if (!token || !domain) {
		return {
			success: false,
			error:
				"Vercel DNS not configured. Set VERCEL_TOKEN and VERCEL_DOMAIN (or NEXT_PUBLIC_DEPLOYMENT_DOMAIN).",
		};
	}

	const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
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

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
	const listUrl = new URL(`${VERCEL_API_BASE}/v4/domains/${encodeURIComponent(baseDomain)}/records`);

	async function listRecords(): Promise<any[]> {
		const listRes = await fetch(listUrl.toString(), { headers });
		if (!listRes.ok) return [];
		const listData = await listRes.json();
		return Array.isArray(listData.records) ? listData.records : Array.isArray(listData) ? listData : [];
	}

	function recordNameMatches(r: { name?: string }, wanted: string): boolean {
		return r?.name === wanted || (r?.name === "" && wanted === baseDomain);
	}

	function getRecordId(r: any): string | null {
		return (r?.id ?? r?.uid) ? String(r.id ?? r.uid) : null;
	}

	async function deleteRecordById(recordId: string): Promise<boolean> {
		const delUrl = `${VERCEL_API_BASE}/v2/domains/${encodeURIComponent(baseDomain)}/records/${encodeURIComponent(recordId)}`;
		const delRes = await fetch(delUrl, { method: "DELETE", headers });
		return delRes.ok;
	}

	try {
		const records = await listRecords();
		const toDelete = records.filter((r: any) => recordNameMatches(r, subdomain as string));
		if (toDelete.length === 0) return { success: true, deletedCount: 0 };

		let deletedCount = 0;
		for (const r of toDelete) {
			const id = getRecordId(r);
			if (!id) continue;
			const ok = await deleteRecordById(id);
			if (ok) deletedCount += 1;
		}

		return { success: true, deletedCount };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to delete DNS record";
		console.error("Vercel deleteVercelDnsRecord error:", error);
		return { success: false, error: message };
	}
}
