import { NextResponse } from "next/server";
import { createWebSocketAuthToken } from "@/lib/wsAuth";
import { buildWebSocketHealthUrl } from "@/lib/wsUrls";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ServiceStatus = {
	name: string;
	status: "healthy" | "unavailable";
	message: string;
};

function getWorkerHealthzUrl(token: string) {
	const wsBase = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";
	const healthUrl = new URL(buildWebSocketHealthUrl(wsBase, "/healthz"));
	healthUrl.searchParams.set("auth", token);
	return healthUrl.toString();
}

async function checkWebsocketHealth(userID: string): Promise<ServiceStatus> {
	try {
		const token = createWebSocketAuthToken(userID);
		const response = await fetch(getWorkerHealthzUrl(token), {
			method: "GET",
			cache: "no-store",
		});

		if (!response.ok) {
			throw new Error(`Health check returned ${response.status}`);
		}

		const payload = (await response.json()) as { ok?: boolean; status?: string };
		const healthy = payload.ok !== false && payload.status !== "unhealthy";

		return {
			name: "WebSocket server",
			status: healthy ? "healthy" : "unavailable",
			message: healthy ? "Authenticated worker health check passed" : "Worker health check failed",
		};
	} catch (error) {
		return {
			name: "WebSocket server",
			status: "unavailable",
			message: error instanceof Error ? error.message : "Worker unavailable",
		};
	}
}

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
	const session = await auth.api.getSession({ headers: req?.headers ?? new Headers() });
	const userID = session?.user?.id;

	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const services = await Promise.all([
		checkWebsocketHealth(userID),
		checkAnalyzeHealth(),
	]);

	const overallStatus = services.every((service) => service.status === "healthy") ? "healthy" : "degraded";

	return NextResponse.json(
		{
			status: overallStatus,
			services,
			timestamp: new Date().toISOString(),
		},
		{ status: 200 }
	);
}
