import React from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/apps/browserCallback", async (original) => ({ ...await original<typeof import("@/lib/apps/browserCallback")>(), openAppCallback: vi.fn() }));
import { AppLoginApproval } from "@/components/apps/AppLoginApproval";
import { openAppCallback } from "@/lib/apps/browserCallback";
import type { GatewayAppInspection } from "@/lib/apps/gatewayAuthStore";

const REQUEST = { bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", challenge: "c".repeat(43), state: "s".repeat(43) };
const APP: GatewayAppInspection = { bindingId: REQUEST.bindingId, app: { id: "app", name: "Inventory" }, workspace: { id: "workspace", name: "Operations" },
	origin: "https://inventory.test", environment: "published", identity: { id: "user", email: "colleague@example.test" } };
const transport = vi.fn<typeof fetch>();
function receipt() { return Response.json({ code: "k".repeat(43), state: REQUEST.state, callbackUrl: APP.origin + "/__smartdeploy/callback", expiresAt: new Date(Date.now() + 60000).toISOString() }); }
beforeEach(() => { vi.clearAllMocks(); transport.mockReset(); vi.stubGlobal("fetch", transport); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("explicit app sign-in confirmation", () => {
	it("disables server-rendered approval until its click handler can hydrate", () => {
		const markup = renderToString(<AppLoginApproval request={REQUEST} app={APP} />);
		expect(markup).toMatch(/<button[^>]*disabled=""/);
		expect(transport).not.toHaveBeenCalled();
	});
	it("shows current identity, workspace, environment and destination without issuing on display", () => {
		render(<AppLoginApproval request={REQUEST} app={APP} />);
		expect(screen.getByRole("heading", { name: "Open Inventory?" })).toBeVisible();
		for (const value of [APP.identity.email, APP.workspace.name, APP.origin, "Published app"]) expect(screen.getByText(value)).toBeVisible();
		expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/");
		expect(transport).not.toHaveBeenCalled();
	});
	it("labels an authorized unpublished preview distinctly", () => {
		render(<AppLoginApproval request={REQUEST} app={{ ...APP, environment: "preview" }} />);
		expect(screen.getByText("Unpublished workspace preview")).toBeVisible();
	});
	it("issues once after a click and navigates only with a validated receipt", async () => {
		transport.mockResolvedValue(receipt());
		render(<AppLoginApproval request={REQUEST} app={APP} />);
		const button = screen.getByRole("button", { name: "Continue to app" });
		fireEvent.click(button); fireEvent.click(button);
		await waitFor(() => expect(openAppCallback).toHaveBeenCalledOnce());
		expect(transport).toHaveBeenCalledOnce();
		expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({ ...REQUEST, expectedIdentity: APP.identity });
		expect(openAppCallback).toHaveBeenCalledWith(expect.stringContaining(APP.origin + "/__smartdeploy/callback?code="));
	});
	it.each([200, 409, 503])("retains the page with a refresh requirement after unconfirmed HTTP %s", async (status) => {
		transport.mockResolvedValue(Response.json({ error: "internal credentials must not be shown" }, { status }));
		render(<AppLoginApproval request={REQUEST} app={APP} />);
		fireEvent.click(screen.getByRole("button", { name: "Continue to app" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Refresh this page");
		expect(screen.getByRole("button", { name: "Continue to app" })).toBeDisabled();
		expect(screen.queryByText(/internal credentials/)).toBeNull();
		expect(openAppCallback).not.toHaveBeenCalled();
	});
	it("aborts on unmount and ignores a late successful response", async () => {
		let resolve: (response: Response) => void = () => {};
		transport.mockImplementation(() => new Promise<Response>((finish) => { resolve = finish; }));
		const view = render(<AppLoginApproval request={REQUEST} app={APP} />);
		fireEvent.click(screen.getByRole("button", { name: "Continue to app" }));
		view.unmount();
		expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
		await act(async () => { resolve(receipt()); });
		expect(openAppCallback).not.toHaveBeenCalled();
	});
	it("aborts a pending request when Cancel is clicked and ignores its later response", async () => {
		let resolve: (response: Response) => void = () => {};
		transport.mockImplementation(() => new Promise<Response>((finish) => { resolve = finish; }));
		render(<AppLoginApproval request={REQUEST} app={APP} />);
		fireEvent.click(screen.getByRole("button", { name: "Continue to app" }));
		fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
		expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
		await act(async () => { resolve(receipt()); });
		expect(openAppCallback).not.toHaveBeenCalled();
	});
	it("shows an error after the deadline aborts a stalled native fetch", async () => {
		vi.useFakeTimers();
		transport.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }); }));
		render(<AppLoginApproval request={REQUEST} app={APP} />);
		fireEvent.click(screen.getByRole("button", { name: "Continue to app" }));
		await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
		expect(screen.getByRole("alert")).toHaveTextContent("Refresh this page");
		expect(openAppCallback).not.toHaveBeenCalled();
	});
});
