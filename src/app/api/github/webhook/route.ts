import { NextResponse } from "next/server";

import { dbHelper } from "@/db-helper";
import { getGithubAppConfig, verifyGithubWebhookSignature } from "@/lib/githubApp";
import { queueGithubPushDeployments } from "@/lib/githubAutoDeploy";
import { parseGithubPushWebhook } from "@/lib/githubWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
	const config = getGithubAppConfig();
	if (!config) {
		console.error("GitHub webhook received without complete GitHub App configuration.");
		return NextResponse.json({ error: "GitHub App is not configured" }, { status: 503 });
	}

	const payload = await request.text();
	if (!verifyGithubWebhookSignature({
		payload,
		signature: request.headers.get("x-hub-signature-256"),
		webhookSecret: config.webhookSecret,
	})) {
		return NextResponse.json({ error: "Invalid GitHub webhook signature" }, { status: 401 });
	}

	const eventName = request.headers.get("x-github-event")?.trim() || "";
	if (eventName === "ping") {
		return NextResponse.json({ ok: true });
	}
	if (eventName !== "push") {
		return new NextResponse(null, { status: 204 });
	}

	const deliveryId = request.headers.get("x-github-delivery")?.trim() || "";
	if (!deliveryId) {
		return NextResponse.json({ error: "Missing GitHub delivery ID" }, { status: 400 });
	}

	let parsedPayload: unknown;
	try {
		parsedPayload = JSON.parse(payload) as unknown;
	} catch {
		return NextResponse.json({ error: "Invalid GitHub webhook payload" }, { status: 400 });
	}
	const push = parseGithubPushWebhook(parsedPayload);
	if (!push) {
		return new NextResponse(null, { status: 204 });
	}

	const claimed = await dbHelper.claimGithubWebhookDelivery({ deliveryId, eventName });
	if (claimed.error) {
		console.error("Could not persist GitHub webhook delivery:", claimed.error);
		return NextResponse.json({ error: "Could not process GitHub webhook" }, { status: 503 });
	}
	if (!claimed.claimed) {
		return NextResponse.json({ accepted: true, duplicate: true }, { status: 202 });
	}

	try {
		const result = await queueGithubPushDeployments(push);
		return NextResponse.json({ accepted: true, ...result }, { status: 202 });
	} catch (error) {
		console.error("GitHub push deployment queue failed:", error);
		await dbHelper.releaseGithubWebhookDelivery(deliveryId);
		return NextResponse.json({ error: "Could not queue deployment" }, { status: 500 });
	}
}
