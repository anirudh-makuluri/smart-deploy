import React, { type ReactNode } from "react";
import type { PostHogConfig, CapturedNetworkRequest } from "posthog-js";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const captured = vi.hoisted(() => ({ options: [] as Partial<PostHogConfig>[] }));
vi.mock("posthog-js/react", () => ({ PostHogProvider: ({ options, children }: { options: Partial<PostHogConfig>; children: ReactNode }) => { captured.options.push(options); return <>{children}</>; } }));
vi.mock("@/components/analytics/PosthogIdentify", () => ({ PosthogIdentify: () => null }));
vi.mock("@/components/analytics/PosthogWebVitals", () => ({ PosthogWebVitals: () => null }));
beforeEach(() => { vi.resetModules(); captured.options.length = 0; vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_local_privacy_test_only"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("PostHog invitation privacy contract", () => {
	it("sets the SDK's fragment privacy flag at initialization and excludes sensitive request/response bodies", async () => {
		const { PosthogGate } = await import("@/components/analytics/PosthogGate"); render(<PosthogGate>Test</PosthogGate>);
		const options = captured.options[0]; expect(options.disable_capture_url_hashes).toBe(true);
		const mask = options.session_recording?.maskCapturedNetworkRequestFn; expect(mask).toBeTypeOf("function");
		const request: CapturedNetworkRequest = { name: "https://platform.example.test/api/auth/sign-in/social", entryType: "resource", startTime: 0, duration: 1, requestBody: "sensitive OAuth callback fragment", responseBody: "sensitive server response" };
		expect(mask?.(request)).toBeNull();
		expect(mask?.({ ...request, name: "https://platform.example.test/apps/invitations#token=secret", isInitial: true })).toBeNull();
		const normal = { ...request, name: "https://platform.example.test/api/health", requestBody: "", responseBody: "healthy" }; expect(mask?.(normal)).toBe(normal);
	});
});
