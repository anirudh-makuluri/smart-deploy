import type { RuntimeControlView } from "@/lib/apps/runtimeControlProtocol";

export const RUNTIME_APP = "a7c69bec-6f19-40db-88bb-c826594e4bc7";
export const RUNTIME_REQUEST = "136eece9-c619-4946-87ee-027946029182";
export const RELEASE_ONE = "11111111-1111-4111-8111-111111111111";
export const RELEASE_TWO = "22222222-2222-4222-8222-222222222222";
export const RELEASE_PREVIEW = "33333333-3333-4333-8333-333333333333";
export const RUNTIME_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const RUNTIME_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PUBLISHED_ORIGIN = "https://44444444-4444-4444-8444-444444444444.apps.smart-deploy.xyz";
export const PREVIEW_ORIGIN = "https://55555555-5555-4555-8555-555555555555.apps.smart-deploy.xyz";
export function runtimeView(): RuntimeControlView {
	return { expiresAt: Date.now() + 120000, choices: [
		{ environment: "published", releaseId: RELEASE_ONE, label: "Notes v1", available: true },
		{ environment: "published", releaseId: RELEASE_TWO, label: "Notes v2", available: true },
		{ environment: "preview", releaseId: RELEASE_PREVIEW, label: "Draft preview", available: true },
	], selected: [{ environment: "published", runtimeId: RUNTIME_ONE, releaseId: RELEASE_ONE, generation: 1, origin: PUBLISHED_ORIGIN, available: true }] };
}
