import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { sanitizeSubdomain } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		if (!session?.accessToken) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const token = process.env.VERCEL_TOKEN;
		const domain = (process.env.VERCEL_DOMAIN || process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN || "").trim();
		if (!token || !domain) {
			return NextResponse.json(
				{ error: "Vercel DNS not configured. Set VERCEL_TOKEN and VERCEL_DOMAIN (or NEXT_PUBLIC_DEPLOYMENT_DOMAIN)." },
				{ status: 503 }
			);
		}

		const body = await req.json();
		const deployUrl = typeof body.deployUrl === "string" ? body.deployUrl.trim() : "";
		const serviceName = typeof body.service_name === "string" ? body.service_name : "app";
		if (!deployUrl) {
			return NextResponse.json({ error: "deployUrl is required" }, { status: 400 });
		}

		const targetHost = getDeployUrlHostname(deployUrl);
		if (!targetHost) {
			return NextResponse.json({ error: "Invalid deployUrl" }, { status: 400 });
		}

		const subdomain = sanitizeSubdomain(serviceName);
		const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const createUrl = new URL(`${VERCEL_API_BASE}/v2/domains/${encodeURIComponent(baseDomain)}/records`);

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
			const data = await createRes.json();
			const customUrl = `https://${subdomain}.${baseDomain}`;
			return NextResponse.json({
				success: true,
				customUrl,
				uid: data.uid,
			});
		}

		const errBody = await createRes.text();
		let errJson: { error?: { code?: string; message?: string } } = {};
		try {
			errJson = JSON.parse(errBody);
		} catch {
			// ignore
		}

		// If record already exists (e.g. duplicate), try to update it
		if (createRes.status === 400 || createRes.status === 409 || (errJson.error?.message || "").toLowerCase().includes("already exists")) {
			const listUrl = new URL(`${VERCEL_API_BASE}/v4/domains/${encodeURIComponent(baseDomain)}/records`);

			const listRes = await fetch(listUrl.toString(), { headers });
			if (!listRes.ok) {
				return NextResponse.json(
					{ error: "Failed to create or update DNS record", details: errJson.error?.message || errBody },
					{ status: createRes.status }
				);
			}

			const listData = await listRes.json();
			const records = Array.isArray(listData.records) ? listData.records : Array.isArray(listData) ? listData : [];
			const existing = records.find(
				(r: { name?: string; recordType?: string }) => (r.name === subdomain || (r.name === "" && subdomain === baseDomain)) && (r.recordType === "CNAME" || (r as { type?: string }).type === "CNAME")
			);
			const recordId = existing?.id ?? (existing as { uid?: string })?.uid;
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
					return NextResponse.json({ success: true, customUrl, updated: true });
				}
			}
		}

		return NextResponse.json(
			{ error: errJson.error?.message || "Vercel API error", details: errBody },
			{ status: createRes.status >= 400 ? createRes.status : 500 }
		);
	} catch (error) {
		console.error("Vercel add-dns-record error:", error);
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Failed to add DNS record" },
			{ status: 500 }
		);
	}
}
