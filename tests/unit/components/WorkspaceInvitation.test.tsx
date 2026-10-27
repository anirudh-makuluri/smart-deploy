import React, { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ read: vi.fn(), login: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { useSession: session.read } }));
vi.mock("@/components/login-form", () => ({ LoginForm: ({ callbackURL }: { callbackURL: string }) => { session.login(callbackURL); return <button>Continue with GitHub</button>; } }));
import { WorkspaceInvitation } from "@/components/apps/WorkspaceInvitation";
const TOKEN = "a".repeat(43); const ID = "9d888612-4141-4402-bbfd-23736a11bd46";
const DETAILS = { workspace: { id: ID, name: "Test operations" }, role: "member", expiresAt: "2026-10-27T00:00:00Z" };
const fetcher = vi.fn<typeof fetch>();
function verified() { return { data: { user: { id: "member", email: "member@example.test", emailVerified: true } }, isPending: false }; }
beforeEach(() => { vi.clearAllMocks(); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); session.read.mockReturnValue(verified()); window.history.replaceState(null, "", "/apps/invitations#token=" + TOKEN); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("explicit workspace invitation UI", () => {
	it("keeps server-rendered controls inert and never serializes the invitation token", () => {
		const html = renderToString(<WorkspaceInvitation />); expect(html).not.toContain(TOKEN); expect(html).not.toContain("Join workspace"); expect(fetcher).not.toHaveBeenCalled();
	});
	it("keeps the secret only in the same-origin OAuth return fragment and scrubs the address", async () => {
		session.read.mockReturnValue({ data: null, isPending: false }); render(<StrictMode><WorkspaceInvitation /></StrictMode>);
		expect(await screen.findByRole("button", { name: "Continue with GitHub" })).toBeVisible();
		expect(session.login).toHaveBeenLastCalledWith("/apps/invitations#token=" + TOKEN); expect(window.location.hash).toBe(""); expect(document.body.textContent).not.toContain(TOKEN); expect(fetcher).not.toHaveBeenCalled();
	});
	it("requires verification before inspection", async () => {
		const value = verified(); value.data.user.emailVerified = false; session.read.mockReturnValue(value); render(<WorkspaceInvitation />);
		expect(await screen.findByRole("alert")).toHaveTextContent("verified email"); expect(fetcher).not.toHaveBeenCalled();
	});
	it("reviews without joining, then accepts exactly once after the user clicks", async () => {
		fetcher.mockImplementation(async url => Response.json(String(url).endsWith("/inspect") ? DETAILS : { workspace: DETAILS.workspace, role: "member" }));
		render(<WorkspaceInvitation />); const button = await screen.findByRole("button", { name: "Join workspace" });
		expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toContain("/inspect"); expect(screen.getByText("member@example.test")).toBeVisible();
		expect(screen.getByText(/Joining does not grant deployment/)).toBeVisible();
		fireEvent.click(button); fireEvent.click(button); expect(await screen.findByText(/You’ve joined Test operations/)).toBeVisible();
		expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/accept"))).toHaveLength(1);
	});
	it("rejects an unrelated successful receipt and requires membership confirmation before retry", async () => {
		fetcher.mockImplementation(async url => Response.json(String(url).endsWith("/inspect") ? DETAILS : { workspace: { ...DETAILS.workspace, id: "997a2326-5b9b-4c08-aaef-45c618db01d3" }, role: "member" }));
		render(<WorkspaceInvitation />); fireEvent.click(await screen.findByRole("button", { name: "Join workspace" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("may have completed"); expect(screen.getByRole("button", { name: "Join workspace" })).toBeDisabled(); expect(screen.queryByText(/You’ve joined/)).toBeNull();
	});
	it.each([401, 403, 410, 503])("does not expose workspace details or provider errors after denied inspection %s", async status => {
		fetcher.mockResolvedValue(Response.json({ error: "private provider credential" }, { status })); render(<WorkspaceInvitation />);
		expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.queryByText("Test operations")).toBeNull(); expect(screen.queryByRole("button", { name: "Join workspace" })).toBeNull(); expect(document.body.textContent).not.toContain("private provider credential");
	});
	it("aborts old inspection when the identity disappears and discards its late result", async () => {
		let finish = (_response: Response) => {}; fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = render(<WorkspaceInvitation />); await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		session.read.mockReturnValue({ data: null, isPending: false }); view.rerender(<WorkspaceInvitation />);
		expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true); await act(async () => { finish(Response.json(DETAILS)); });
		expect(screen.queryByText("Test operations")).toBeNull(); expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
	});
	it("cancels a pending acceptance immediately and ignores a late response", async () => {
		let finish = (_response: Response) => {}; fetcher.mockResolvedValueOnce(Response.json(DETAILS)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		render(<WorkspaceInvitation />); fireEvent.click(await screen.findByRole("button", { name: "Join workspace" }));
		fireEvent.click(screen.getByRole("link", { name: "Cancel" })); expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
		await act(async () => { finish(Response.json({ workspace: DETAILS.workspace, role: "member" })); }); expect(screen.queryByText(/You’ve joined/)).toBeNull();
	});
	it("does not make an auth or invitation action for a malformed fragment", async () => {
		window.history.replaceState(null, "", "/apps/invitations#token=bad"); render(<WorkspaceInvitation />);
		expect(await screen.findByRole("alert")).toHaveTextContent("complete invitation link"); expect(fetcher).not.toHaveBeenCalled(); expect(session.login).not.toHaveBeenCalled();
	});
});
