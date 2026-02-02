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
 * Add or update a CNAME record in Vercel DNS for the given deploy URL and service name.
 * Call from backend (e.g. handleDeploy) after a successful deploy.
 * Returns success: false with error message if not configured or API fails.
 */
export async function addVercelDnsRecord(
	deployUrl: string,
	serviceName: string
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

	const subdomain = sanitizeSubdomain(name);
	const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};

	const createUrl = new URL(
		`${VERCEL_API_BASE}/v2/domains/${encodeURIComponent(baseDomain)}/records`
	);

	try {
		const createRes = await fetch(createUrl.toString(), {
			method: "POST",
			headers,
			body: JSON.stringify({
				type: "CNAME",
				name: subdomain,
				value: targetHost,
				ttl: 60,
				comment: "SmartDeploy",
			}),
		});

		if (createRes.ok) {
			const customUrl = `https://${subdomain}.${baseDomain}`;
			return { success: true, customUrl };
		}

		const errBody = await createRes.text();
		let errJson: { error?: { message?: string } } = {};
		try {
			errJson = JSON.parse(errBody);
		} catch {
			// ignore
		}

		const errMsg = (errJson.error?.message || "").toLowerCase();
		const isConflict =
			createRes.status === 400 ||
			createRes.status === 409 ||
			errMsg.includes("already exists");

		if (isConflict) {
			const listUrl = new URL(
				`${VERCEL_API_BASE}/v4/domains/${encodeURIComponent(baseDomain)}/records`
			);
			const listRes = await fetch(listUrl.toString(), { headers });
			if (!listRes.ok) {
				return {
					success: false,
					error:
						errJson.error?.message ||
						"Failed to create or update DNS record",
				};
			}

			const listData = await listRes.json();
			const records = Array.isArray(listData.records)
				? listData.records
				: Array.isArray(listData)
					? listData
					: [];
			const existing = records.find(
				(r: { name?: string; recordType?: string; type?: string }) =>
					(r.name === subdomain || (r.name === "" && subdomain === baseDomain)) &&
					(r.recordType === "CNAME" || r.type === "CNAME")
			);
			const recordId =
				(existing as { id?: string })?.id ??
				(existing as { uid?: string })?.uid;
			if (recordId) {
				const updateUrl = `${VERCEL_API_BASE}/v1/domains/records/${encodeURIComponent(recordId)}`;
				const updateRes = await fetch(updateUrl, {
					method: "PATCH",
					headers,
					body: JSON.stringify({
						name: subdomain,
						type: "CNAME",
						value: targetHost,
						ttl: 60,
					}),
				});
				if (updateRes.ok) {
					const customUrl = `https://${subdomain}.${baseDomain}`;
					return { success: true, customUrl };
				}
			}
		}

		return {
			success: false,
			error: errJson.error?.message || "Vercel API error",
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to add DNS record";
		console.error("Vercel addVercelDnsRecord error:", error);
		return { success: false, error: message };
	}
}
