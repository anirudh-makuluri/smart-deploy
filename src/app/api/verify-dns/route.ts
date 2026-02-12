import { NextRequest, NextResponse } from "next/server";

const VERCEL_API_BASE = "https://api.vercel.com";

function sanitizeSubdomain(s: string): string {
	const out = s
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

export async function POST(req: NextRequest) {
	try {
		const { subdomain, currentDeploymentId } = await req.json();

		if (!subdomain || typeof subdomain !== "string") {
			return NextResponse.json({ error: "Subdomain is required" }, { status: 400 });
		}

		const token = (process.env.VERCEL_TOKEN || "").trim();
		const domain = (
			process.env.VERCEL_DOMAIN ||
			process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
			""
		).trim();

		if (!token || !domain) {
			return NextResponse.json(
				{ error: "Vercel DNS not configured" },
				{ status: 500 }
			);
		}

		const baseDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
		const sanitized = sanitizeSubdomain(subdomain);

		// List all DNS records
		const listUrl = `${VERCEL_API_BASE}/v4/domains/${encodeURIComponent(baseDomain)}/records`;
		const headers = {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};

		const listRes = await fetch(listUrl, { headers });
		if (!listRes.ok) {
			return NextResponse.json(
				{ error: "Failed to fetch DNS records" },
				{ status: 500 }
			);
		}

		const listData = await listRes.json();
		const records = Array.isArray(listData.records)
			? listData.records
			: Array.isArray(listData)
			? listData
			: [];

		// Check if the subdomain exists
		const existingRecord = records.find(
			(r: any) => r.name === sanitized && (r.type === "A" || r.type === "CNAME")
		);

		if (!existingRecord) {
			// Subdomain is available
			return NextResponse.json({
				available: true,
				subdomain: sanitized,
				customUrl: `https://${sanitized}.${baseDomain}`,
			});
		}

		// Subdomain exists - check if it belongs to current deployment
		// We need to check against the deployment's metadata or compare with service names
		// For now, we'll check if the deployment ID matches (this requires metadata in DNS records)
		// Since we don't store deployment IDs in DNS, we'll use a simpler approach:
		// If they provide their currentDeploymentId, we check if the existing custom_url matches

		// Get current deployment to check if this subdomain is already theirs
		if (currentDeploymentId) {
			const { db } = await import("@/lib/firebaseAdmin");
			const deploymentRef = db.collection("deployments").doc(currentDeploymentId);
			const deploymentDoc = await deploymentRef.get();
			
			if (deploymentDoc.exists) {
				const deploymentData = deploymentDoc.data();
				const currentCustomUrl = deploymentData?.custom_url || "";
				const currentSubdomain = currentCustomUrl
					.replace(/^https?:\/\//, "")
					.replace(/\..*$/, "");

				if (currentSubdomain === sanitized) {
					// This subdomain already belongs to them
					return NextResponse.json({
						available: true,
						isOwned: true,
						subdomain: sanitized,
						customUrl: `https://${sanitized}.${baseDomain}`,
					});
				}
			}
		}

		// Subdomain exists and is NOT theirs - suggest alternatives
		const alternatives: string[] = [];
		for (let i = 1; i <= 5; i++) {
			const alt = `${sanitized}-${i}`;
			const altExists = records.find(
				(r: any) => r.name === alt && (r.type === "A" || r.type === "CNAME")
			);
			if (!altExists) {
				alternatives.push(alt);
			}
			if (alternatives.length >= 3) break;
		}

		return NextResponse.json({
			available: false,
			subdomain: sanitized,
			alternatives,
			message: `Subdomain "${sanitized}" is already taken`,
		});
	} catch (error) {
		console.error("DNS verification error:", error);
		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 }
		);
	}
}
