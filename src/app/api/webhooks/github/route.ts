import { NextRequest, NextResponse } from "next/server";
import config from "@/config";
import { verifyGithubWebhookSignature } from "@/lib/githubWebhookVerify";
import { forwardAutoDeployJobToWorker } from "@/lib/autoDeployWorkerClient";
import { isNullSha, pushBranchFromRef } from "@/lib/githubPushWebhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const recentDeliveries = new Map<string, number>();
const DEDUP_TTL_MS = 15 * 60 * 1000;

function pruneDeliveries() {
	const now = Date.now();
	for (const [id, t] of recentDeliveries) {
		if (now - t > DEDUP_TTL_MS) recentDeliveries.delete(id);
	}
}

function rememberDelivery(id: string): boolean {
	pruneDeliveries();
	if (!id) return true;
	if (recentDeliveries.has(id)) return false;
	recentDeliveries.set(id, Date.now());
	return true;
}

export async function POST(req: NextRequest) {
	const secret = config.GITHUB_APP_WEBHOOK_SECRET?.trim();
	if (!secret) {
		console.error("GITHUB_APP_WEBHOOK_SECRET is not configured");
		return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
	}

	const rawBody = await req.text();
	const sig = req.headers.get("x-hub-signature-256");
	if (!verifyGithubWebhookSignature(rawBody, sig, secret)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const event = req.headers.get("x-github-event") || "";
	const delivery = req.headers.get("x-github-delivery") || "";

	if (event === "ping") {
		return NextResponse.json({ ok: true });
	}

	if (event !== "push") {
		return NextResponse.json({ ignored: true }, { status: 202 });
	}

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(rawBody) as Record<string, unknown>;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const branch = pushBranchFromRef(payload.ref);
	if (!branch) {
		return NextResponse.json({ ignored: true }, { status: 202 });
	}

	const installation = payload.installation as { id?: number } | undefined;
	const repository = payload.repository as { full_name?: string } | undefined;
	const after = payload.after;

	const installationId = installation?.id;
	const fullName = repository?.full_name?.trim();

	if (!installationId || !fullName || isNullSha(after)) {
		return NextResponse.json({ ignored: true }, { status: 202 });
	}

	if (!rememberDelivery(delivery)) {
		return NextResponse.json({ duplicate: true }, { status: 202 });
	}

	const workerSecret = config.DEPLOY_WORKER_SECRET?.trim();
	if (!workerSecret) {
		console.error("DEPLOY_WORKER_SECRET is not set");
		return NextResponse.json({ error: "Worker not configured" }, { status: 503 });
	}

	const { ok, status, body } = await forwardAutoDeployJobToWorker({
		installationId,
		fullName,
		branch,
		commitSha: after as string,
		deliveryId: delivery || undefined,
	});

	if (!ok) {
		console.error("forwardAutoDeployJobToWorker failed:", status, body);
		return NextResponse.json({ error: "Worker forward failed" }, { status: 502 });
	}

	return NextResponse.json({ accepted: true }, { status: 202 });
}
