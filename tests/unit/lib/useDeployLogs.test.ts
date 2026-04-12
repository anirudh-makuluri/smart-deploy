import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthenticatedWebSocketHealthUrl, getWebSocketHealthUrl, getWebSocketUrl } from "@/custom-hooks/useDeployLogs";

describe("getWebSocketUrl", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("prefers NEXT_PUBLIC_WS_URL when provided", () => {
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "https://ws.example.com");

		expect(getWebSocketUrl()).toBe("wss://ws.example.com");
	});

	it("uses same-origin ws on http pages when no env override is set", () => {
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
		const protocol = window.location.protocol === "https:" ? "wss" : "ws";

		expect(getWebSocketUrl()).toBe(`${protocol}://${window.location.host}/ws`);
	});

	it("derives the worker health endpoint from the websocket URL", () => {
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "https://ws.example.com/ws");

		expect(getWebSocketHealthUrl()).toBe("https://ws.example.com/health");
	});

	it("derives the authenticated worker health endpoint from the websocket URL", () => {
		vi.stubEnv("NEXT_PUBLIC_WS_URL", "https://ws.example.com/ws");

		expect(getAuthenticatedWebSocketHealthUrl("test-token")).toBe("https://ws.example.com/healthz?auth=test-token");
	});
});
