import React from "react";
import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const worker = vi.hoisted(() => ({ status: "open", request: vi.fn() }));
vi.mock("@/components/WorkerWebSocketProvider", () => ({ useWorkerWebSocket: () => ({ socketStatus: worker.status, requestAppRuntime: worker.request }) }));
import { RuntimePublishing } from "@/components/apps/RuntimePublishing";
import { WorkspaceBrowserError } from "@/lib/apps/workspaceBrowser";
import type { RuntimeControlRequest, RuntimeControlView } from "@/lib/apps/runtimeControlProtocol";
import { PUBLISHED_ORIGIN, PREVIEW_ORIGIN, RELEASE_PREVIEW, RELEASE_TWO, RUNTIME_APP, RUNTIME_ONE, RUNTIME_TWO, runtimeView } from "../helpers/runtimeView";

const app = { id: RUNTIME_APP, workspaceId: RUNTIME_ONE, name: "Team notes", createdBy: "creator", legacyDeploymentId: null };
let view: RuntimeControlView; const caches: QueryClient[] = [];
function mount() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache); return render(<QueryClientProvider client={cache}><RuntimePublishing actorId="creator" app={app} /></QueryClientProvider>); }
beforeEach(() => {
	vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); worker.status = "open"; view = runtimeView();
	worker.request.mockImplementation(async (_actor: string, request: RuntimeControlRequest) => {
		if (request.action === "activate") {
			view.selected = [...view.selected.filter(row => row.environment !== request.environment), { environment: request.environment, releaseId: request.releaseId, runtimeId: RUNTIME_TWO, generation: 2, origin: request.environment === "preview" ? PREVIEW_ORIGIN : PUBLISHED_ORIGIN, available: true }];
			if (request.environment === "published") view.choices[0].available = false;
		}
		return structuredClone(view);
	});
});
afterEach(() => { for (const cache of caches.splice(0)) cache.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("creator preview and publish controls", () => {
	it("stays inert while the worker is offline", () => {
		worker.status = "closed"; mount(); expect(screen.getByRole("status")).toHaveTextContent("offline"); expect(worker.request).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Publish release" })).toBeNull();
	});
	it("inspects without publishing and keeps preview/published links separate", async () => {
		mount(); expect(await screen.findByLabelText("Published release")).toHaveValue(RELEASE_TWO); expect(screen.getByRole("link", { name: "Open published app" })).toHaveAttribute("href", PUBLISHED_ORIGIN);
		expect(worker.request.mock.calls.every(([, request]) => request.action === "inspect")).toBe(true); expect(screen.queryByRole("link", { name: "Open preview" })).toBeNull(); expect(screen.getByText(/Preview data and secrets stay separate/)).toBeVisible();
	});
	it("publishes only after an explicit click with the reviewed current-runtime precondition", async () => {
		mount(); fireEvent.click(await screen.findByRole("button", { name: "Publish release" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Publish release" })).toBeDisabled());
		await waitFor(() => expect(screen.getByRole("option", { name: "Notes v1 · unavailable" })).toBeDisabled()); expect(screen.getByLabelText("Published release")).toHaveValue(RELEASE_TWO);
		const writes = worker.request.mock.calls.filter(([, request]) => request.action === "activate"); expect(writes).toHaveLength(1); expect(writes[0]).toEqual(["creator", { action: "activate", requestId: expect.any(String), appId: app.id, environment: "published", releaseId: RELEASE_TWO, expectedCurrentId: RUNTIME_ONE }, expect.any(AbortSignal)]);
	});
	it("selects a preview separately and retains published-only sharing", async () => {
		mount(); fireEvent.click(await screen.findByRole("button", { name: "Select preview" }));
		expect(await screen.findByRole("link", { name: "Open preview" })).toHaveAttribute("href", PREVIEW_ORIGIN); expect(screen.getByRole("link", { name: "Open published app" })).toHaveAttribute("href", PUBLISHED_ORIGIN);
		expect(worker.request.mock.calls.find(([, request]) => request.action === "activate")?.[1]).toMatchObject({ environment: "preview", releaseId: RELEASE_PREVIEW, expectedCurrentId: null });
	});
	it("blocks a second mutation after an uncertain acknowledgement until explicit refresh", async () => {
		worker.request.mockImplementation(async (_actor: string, request: RuntimeControlRequest) => { if (request.action === "activate") throw new WorkspaceBrowserError(503); return view; }); mount(); fireEvent.click(await screen.findByRole("button", { name: "Publish release" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("may have completed"); expect(screen.getByRole("button", { name: "Publish release" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Select preview" })).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "Refresh status" })); await waitFor(() => expect(screen.getByRole("button", { name: "Publish release" })).toBeEnabled()); expect(worker.request.mock.calls.filter(([, request]) => request.action === "activate")).toHaveLength(1);
	});
	it("copies only the published public URL after an explicit click", async () => {
		const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } }); mount();
		fireEvent.click(await screen.findByRole("button", { name: "Copy published link" })); expect(await screen.findByText("Copied")).toBeVisible(); expect(copy).toHaveBeenCalledExactlyOnceWith(PUBLISHED_ORIGIN);
	});
	it("retires all actions and links at the demo deadline without requiring a network response", async () => {
		vi.useFakeTimers(); view.expiresAt = Date.now() + 2000; mount(); await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(screen.getByRole("button", { name: "Publish release" })).toBeEnabled();
		await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(screen.getByRole("status")).toHaveTextContent("window has ended"); expect(screen.queryByRole("link", { name: "Open published app" })).toBeNull(); expect(screen.queryByRole("button", { name: "Publish release" })).toBeNull();
	});
});
