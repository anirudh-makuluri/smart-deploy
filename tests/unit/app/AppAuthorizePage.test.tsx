import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/apps/loginConfirmation", () => ({ loadAppLoginConfirmation: mocks.load }));
vi.mock("@/components/login-form", () => ({ LoginForm: ({ callbackURL }: { callbackURL: string }) => <div data-testid="login" data-callback={callbackURL}>Login fixture</div> }));
import Page, { dynamic, metadata } from "@/app/apps/authorize/page";

const REQUEST = { bindingId: "fa03e952-f705-42e2-9706-6a0b425de83d", challenge: "c".repeat(43), state: "s".repeat(43) };
const APP = { bindingId: REQUEST.bindingId, app: { id: "app", name: "Inventory" }, workspace: { id: "workspace", name: "Operations" },
	origin: "https://inventory.test", environment: "published", identity: { id: "user", email: "verified@example.test" } };
beforeEach(() => { vi.clearAllMocks(); mocks.headers.mockResolvedValue(new Headers({ cookie: "test-only" })); });

describe("app confirmation server page", () => {
	it.each(["disabled", "invalid", "denied", "unavailable"])("renders a private generic %s state without app details or Continue", async (status) => {
		mocks.load.mockResolvedValue({ status });
		render(await Page({ searchParams: Promise.resolve(REQUEST) }));
		expect(screen.getByRole("heading", { name: "App sign-in unavailable" })).toBeVisible();
		expect(screen.queryByText(APP.identity.email)).toBeNull();
		expect(screen.queryByRole("button", { name: "Continue to app" })).toBeNull();
	});
	it("passes a validated local callback to embedded login without issuing or exposing app metadata", async () => {
		mocks.load.mockResolvedValue({ status: "signin", callbackURL: "/apps/authorize?bindingId=validated" });
		render(await Page({ searchParams: Promise.resolve(REQUEST) }));
		expect(screen.getByTestId("login")).toHaveAttribute("data-callback", "/apps/authorize?bindingId=validated");
		expect(screen.queryByText("Operations")).toBeNull();
	});
	it("renders only server-inspected app information and remains dynamic/unindexed without referrers", async () => {
		mocks.load.mockResolvedValue({ status: "ready", request: REQUEST, app: APP });
		render(await Page({ searchParams: Promise.resolve(REQUEST) }));
		expect(screen.getByRole("heading", { name: "Open Inventory?" })).toBeVisible();
		expect(mocks.load).toHaveBeenCalledWith(REQUEST, expect.any(Headers));
		expect(dynamic).toBe("force-dynamic"); expect(metadata).toMatchObject({ referrer: "no-referrer", robots: { index: false, follow: false } });
	});
});
