import { PostHog } from "posthog-node";

type ServerCapture = {
	distinctId: string;
	event: string;
	properties?: Record<string, unknown>;
};

let _client: PostHog | null = null;

function getClient(): PostHog | null {
	const apiKey = process.env.POSTHOG_API_KEY || "";
	if (!apiKey) return null;
	if (_client) return _client;
	const host = process.env.POSTHOG_HOST || process.env.POSTHOG_UPSTREAM_HOST || "https://us.i.posthog.com";
	_client = new PostHog(apiKey, { host, flushAt: 1, flushInterval: 0 });
	return _client;
}

/**
 * Fire-and-forget PostHog capture from server/worker.
 * Safe to call even when POSTHOG_API_KEY is unset (no-op).
 */
export function captureServerEvent({ distinctId, event, properties }: ServerCapture): void {
	try {
		const client = getClient();
		if (!client) return;
		client.capture({ distinctId, event, properties });
		// Don't await flush; keep deploy path non-blocking.
		void client.flush();
	} catch {
		// no-op: metrics should never break deploys
	}
}

