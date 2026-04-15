import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ServiceStatus = {
	name: string;
	status: "healthy" | "unavailable";
	message: string;
};

async function checkAnalyzeHealth(): Promise<ServiceStatus> {
	const baseUrl = process.env.SD_API_BASE_URL;
	const bearerToken = process.env.SD_API_BEARER_TOKEN;
	const serviceName = "SD Artifacts server";

	if (!baseUrl || !bearerToken) {
		return {
			name: serviceName,
			status: "unavailable",
			message: "SD_API_BASE_URL or SD_API_BEARER_TOKEN is not configured",
		};
	}

	try {
		const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/healthz`, {
			method: "GET",
			cache: "no-store",
			headers: {
				Authorization: `Bearer ${bearerToken}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Health check returned ${response.status}`);
		}

		const payload = (await response.json()) as { ok?: boolean; status?: string };
		const healthy = payload.ok !== false && payload.status !== "unhealthy";

		return {
			name: serviceName,
			status: healthy ? "healthy" : "unavailable",
			message: healthy ? "Authenticated SD Artifacts health check passed" : "SD Artifacts health check failed",
		};
	} catch (error) {
		return {
			name: serviceName,
			status: "unavailable",
			message: error instanceof Error ? error.message : "SD Artifacts server unavailable",
		};
	}
}

export async function GET(req?: Request) {
	let userID: string | undefined;
	try {
		const session = await auth.api.getSession({ headers: req?.headers ?? new Headers() });
		userID = session?.user?.id;
	} catch (error) {
		console.error("Failed to read session for system health:", error);
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		/** WebSocket worker health comes from the browser session (`useWorkerWebSocket`); server only checks SD Artifacts here. */
		const services = [await checkAnalyzeHealth()];

		const overallStatus = services.every((service) => service.status === "healthy") ? "healthy" : "degraded";

		return NextResponse.json(
			{
				status: overallStatus,
				services,
				timestamp: new Date().toISOString(),
			},
			{ status: 200 }
		);
	} catch (error) {
		console.error("Failed to build system health response:", error);
		return NextResponse.json(
			{
				status: "unavailable",
				services: [{
					name: "SD Artifacts server",
					status: "unavailable",
					message: "System health unavailable",
				}],
				timestamp: new Date().toISOString(),
			},
			{ status: 200 }
		);
	}
}
