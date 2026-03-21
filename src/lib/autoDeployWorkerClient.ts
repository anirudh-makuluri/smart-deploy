import config from "@/config";
import type { AutoDeployJobPayload } from "@/lib/processAutoDeployJob";

export type { AutoDeployJobPayload };

export async function forwardAutoDeployJobToWorker(
	payload: AutoDeployJobPayload
): Promise<{ ok: boolean; status: number; body: string }> {
	const secret = config.DEPLOY_WORKER_SECRET?.trim();
	if (!secret) {
		console.error("DEPLOY_WORKER_SECRET is not set");
		return { ok: false, status: 500, body: "DEPLOY_WORKER_SECRET missing" };
	}

	const url = `${config.DEPLOY_WORKER_URL}/internal/auto-deploy`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${secret}`,
		},
		body: JSON.stringify(payload),
	});
	const body = await res.text();
	return { ok: res.ok, status: res.status, body };
}
