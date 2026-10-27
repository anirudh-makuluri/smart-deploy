// @vitest-environment-options {"url":"https://localhost:3000"}
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { useSession: session.read } }));
import { WorkspaceManagement } from "@/components/apps/WorkspaceManagement";

const WORKSPACE = "a7c69bec-6f19-40db-88bb-c826594e4bc7";
const APP = "136eece9-c619-4946-87ee-027946029182";
const INVITATION = "b96bb4ca-4d87-4867-bebb-9d82126f8960";
const TEAM = { id: WORKSPACE, name: "Test team", kind: "team", ownerId: "owner", role: "owner" };
const APPLICATION = { id: APP, name: "Team notes", workspaceId: WORKSPACE, createdBy: "owner", legacyDeploymentId: null };
const COLLEAGUE = { userId: "colleague", email: "colleague@example.test", role: "member" };
const INVITE = { id: INVITATION, email: COLLEAGUE.email, role: "member", expiresAt: "2026-11-01T00:00:00Z" };
const fetcher = vi.fn<typeof fetch>();
let grants: { userId: string; email: string; grantedBy: string; createdAt: string }[];
let invitations: typeof INVITE[];
let clients: QueryClient[];
function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
	return render(<QueryClientProvider client={client}><WorkspaceManagement principal={{ id: "owner", email: "owner@example.test" }} publishEnabled={false} /></QueryClientProvider>);
}
function route(url: string, init: RequestInit = {}): Response {
	if (init.method === "GET") {
		if (url === "/api/workspaces") return Response.json({ workspaces: [TEAM] });
		if (url.endsWith("/apps")) return Response.json({ apps: [APPLICATION] });
		if (url.endsWith("/members")) return Response.json({ members: [{ userId: "owner", email: "owner@example.test", role: "owner" }, COLLEAGUE] });
		if (url.endsWith("/grants")) return Response.json({ grants });
		if (url.endsWith("/invitations")) return Response.json({ invitations });
	}
	return Response.json({ error: "Unexpected fixture request" }, { status: 500 });
}
beforeEach(() => {
	clients = []; grants = []; invitations = []; vi.clearAllMocks(); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
	session.read.mockReturnValue({ data: { user: { id: "owner", email: "owner@example.test", emailVerified: true } }, isPending: false });
	fetcher.mockImplementation(async (url, init) => route(String(url), init));
});
afterEach(() => { clients.forEach(client => client.clear()); vi.unstubAllGlobals(); });
describe("creator workspace and app sharing", () => {
	it.each([null, { id: "other", email: "owner@example.test", emailVerified: true }, { id: "owner", email: "owner@example.test", emailVerified: false }])("does not query management data after an identity mismatch", async user => {
		session.read.mockReturnValue({ data: user ? { user } : null, isPending: false }); mount(); expect(screen.getByRole("alert")).toHaveTextContent("account changed"); expect(fetcher).not.toHaveBeenCalled();
	});
	it("keeps ordinary members out of management selection", async () => {
		fetcher.mockResolvedValue(Response.json({ workspaces: [{ ...TEAM, role: "member" }] })); mount();
		expect(await screen.findByText(/Only workspace owners and admins/)).toBeVisible(); expect(screen.queryByRole("region", { name: "App access" })).toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
	});
	it("rejects cross-workspace app results", async () => {
		fetcher.mockImplementation(async (url, init) => String(url).endsWith("/apps") ? Response.json({ apps: [{ ...APPLICATION, workspaceId: INVITATION }] }) : route(String(url), init)); mount();
		expect(await screen.findByRole("alert")).toHaveTextContent("apps couldn't be loaded"); expect(screen.queryByRole("button", { name: /Grant app access/ })).toBeNull();
	});
	it("grants and revokes only explicit member access; owner access remains inherited", async () => {
		fetcher.mockImplementation(async (url, init) => {
			if (String(url).endsWith("/grants") && init?.method !== "GET") { grants = init?.method === "POST" ? [{ userId: COLLEAGUE.userId, email: COLLEAGUE.email, grantedBy: "owner", createdAt: "2026-10-26T00:00:00Z" }] : []; return Response.json({ ok: true }); }
			return route(String(url), init);
		}); mount();
		fireEvent.click(await screen.findByRole("button", { name: "Grant app access for " + COLLEAGUE.email }));
		fireEvent.click(await screen.findByRole("button", { name: "Revoke app access for " + COLLEAGUE.email }));
		expect(await screen.findByRole("button", { name: "Grant app access for " + COLLEAGUE.email })).toBeEnabled(); expect(screen.getByText(/inherited access/)).toBeVisible();
		const writes = fetcher.mock.calls.filter(([, init]) => init?.method !== "GET"); expect(writes.map(([, init]) => [init?.method, init?.body])).toEqual([["POST", '{"userId":"colleague"}'], ["DELETE", '{"userId":"colleague"}']]);
	});
	it("blocks duplicate grant attempts after an unconfirmed acknowledgement until refresh", async () => {
		fetcher.mockImplementation(async (url, init) => init?.method !== "GET" ? Response.json({ ok: false }) : route(String(url), init)); mount();
		fireEvent.click(await screen.findByRole("button", { name: "Grant app access for " + COLLEAGUE.email })); expect(await screen.findByRole("alert")).toHaveTextContent("may have completed");
		const button = screen.getByRole("button", { name: "Grant app access for " + COLLEAGUE.email }); expect(button).toBeDisabled(); fireEvent.click(button);
		expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); fireEvent.click(screen.getByRole("button", { name: "Refresh status" })); await waitFor(() => expect(button).toBeEnabled());
	});
	it("preserves a controlled draft and disables pending inputs, then rejects an unrelated app receipt", async () => {
		let finish = (_response: Response) => {}; fetcher.mockImplementation(async (url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : route(String(url), init)); mount();
		const input = await screen.findByLabelText("New app name"); fireEvent.change(input, { target: { value: "Draft notes" } }); fireEvent.submit(screen.getByRole("button", { name: "Create app" }).closest("form")!);
		await waitFor(() => expect(input).toBeDisabled()); await act(async () => { finish(Response.json({ app: { ...APPLICATION, name: "Draft notes", workspaceId: INVITATION } })); });
		expect(await screen.findByRole("alert")).toHaveTextContent("may have completed"); expect(input).toHaveValue("Draft notes"); expect(input).toBeEnabled(); expect(screen.getByRole("button", { name: "Create app" })).toBeDisabled();
	});
	it("creates only a member invitation and hides its one-time link after revocation", async () => {
		const clipboard = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
		fetcher.mockImplementation(async (url, init) => {
			if (init?.method === "POST") { invitations = [INVITE]; return Response.json({ invitation: { ...INVITE, token: "a".repeat(43) } }); }
			if (init?.method === "DELETE") { invitations = []; return Response.json({ ok: true }); }
			return route(String(url), init);
		}); mount(); const email = await screen.findByLabelText("Colleague email"); fireEvent.change(email, { target: { value: "COLLEAGUE@example.test" } });
		fireEvent.submit(screen.getByRole("button", { name: "Create invitation" }).closest("form")!);
		const link = await screen.findByLabelText("Invitation link"); expect(link).toHaveAttribute("type", "password"); expect(link).toHaveValue("https://localhost:3000/apps/invitations#token=" + "a".repeat(43));
		fireEvent.click(screen.getByRole("button", { name: "Copy invitation link" })); expect(await screen.findByRole("status")).toHaveTextContent("Copied"); expect(clipboard).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(JSON.stringify({ email: COLLEAGUE.email, role: "member" }));
		fireEvent.click(screen.getByRole("button", { name: "Revoke invitation for " + COLLEAGUE.email })); await waitFor(() => expect(screen.queryByLabelText("Invitation link")).toBeNull());
	});
	it.each([{ email: "other@example.test" }, { role: "admin" }])("does not reveal a link from an unrelated invitation receipt", async override => {
		fetcher.mockImplementation(async (url, init) => init?.method === "POST" ? Response.json({ invitation: { ...INVITE, token: "a".repeat(43), ...override } }) : route(String(url), init)); mount();
		fireEvent.change(await screen.findByLabelText("Colleague email"), { target: { value: COLLEAGUE.email } }); fireEvent.submit(screen.getByRole("button", { name: "Create invitation" }).closest("form")!);
		expect(await screen.findByRole("alert")).toHaveTextContent("may have completed"); expect(screen.queryByLabelText("Invitation link")).toBeNull();
	});
	it("aborts pending writes and discards late receipts when the current identity changes", async () => {
		let finish = (_response: Response) => {}; fetcher.mockImplementation(async (url, init) => init?.method === "POST" ? new Promise(resolve => { finish = resolve; }) : route(String(url), init)); const view = mount();
		fireEvent.click(await screen.findByRole("button", { name: "Grant app access for " + COLLEAGUE.email })); const write = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
		session.read.mockReturnValue({ data: null, isPending: false }); view.rerender(<QueryClientProvider client={clients[0]}><WorkspaceManagement principal={{ id: "owner", email: "owner@example.test" }} publishEnabled={false} /></QueryClientProvider>);
		expect(write?.[1]?.signal?.aborted).toBe(true); await act(async () => { finish(Response.json({ ok: true })); }); expect(screen.queryByRole("region", { name: "App access" })).toBeNull(); expect(within(screen.getByRole("alert")).queryByText("Team notes")).toBeNull();
	});
});
