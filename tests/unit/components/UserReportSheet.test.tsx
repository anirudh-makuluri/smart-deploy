import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import UserReportSheet from "@/components/UserReportSheet";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const REPORT_ID = "fdc6c0da-0a71-4c47-8e1e-2001390230cc";
const MESSAGE = "The preview controls did not respond.";
const fetchMock = vi.fn<(url: string, options: RequestInit) => Promise<Response>>();

interface InvalidAcknowledgement { label: string; payload: unknown }
const INVALID_ACKNOWLEDGEMENTS: InvalidAcknowledgement[] = [
	{ label: "empty object", payload: {} },
	{ label: "null", payload: null },
	{ label: "array", payload: [] },
	{ label: "missing success flag", payload: { id: REPORT_ID } },
	{ label: "false success flag", payload: { ok: false, id: REPORT_ID } },
	{ label: "missing ID", payload: { ok: true } },
	{ label: "malformed ID", payload: { ok: true, id: "not-a-report-id" } },
	{ label: "non-string ID", payload: { ok: true, id: 42 } },
];

function openReport() {
	const onOpenChange = vi.fn<(open: boolean) => void>();
	render(<UserReportSheet open onOpenChange={onOpenChange} pagePath="/acme/shop" repoOwner="acme" repoName="shop" serviceName="web" />);
	fireEvent.change(screen.getByLabelText("Details"), { target: { value: MESSAGE } });
	return onOpenChange;
}

async function expectRetainedDraft(onOpenChange: (open: boolean) => void) {
	await waitFor(() => {
		expect(toast.error).toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Submit report" })).toBeEnabled();
	});
		expect(screen.getByLabelText("Details")).toHaveValue(MESSAGE);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
}

describe("report submission confirmation", () => {
	beforeEach(() => { vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
	afterEach(() => vi.unstubAllGlobals());

	it.each(INVALID_ACKNOWLEDGEMENTS)("retains the draft for a 200 with $label", async ({ payload }) => {
		fetchMock.mockResolvedValue(Response.json(payload));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("retains the draft when an HTML response has a successful HTTP status", async () => {
		fetchMock.mockResolvedValue(new Response("<html>Sign in again</html>", { headers: { "Content-Type": "text/html" } }));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		expect(toast.error).toHaveBeenCalledWith("Report submission could not be confirmed. Please try again.");
	});

	it("preserves a meaningful HTTP error and the draft", async () => {
		fetchMock.mockResolvedValue(Response.json({ error: "Sign in again to submit your report" }, { status: 401 }));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		expect(toast.error).toHaveBeenCalledWith("Sign in again to submit your report");
	});

	it("handles non-JSON HTTP failures without exposing parser diagnostics", async () => {
		fetchMock.mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		expect(toast.error).toHaveBeenCalledWith("Failed to submit report");
	});

	it("restores retry after a network failure", async () => {
		fetchMock.mockRejectedValue(new Error("Network unavailable"));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		expect(toast.error).toHaveBeenCalledWith("Network unavailable");
	});

	it("clears and closes only for an explicit receipt with a valid ID", async () => {
		fetchMock.mockResolvedValue(Response.json({ ok: true, id: REPORT_ID, extraMetadata: "allowed" }));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
			expect(screen.getByLabelText("Details")).toHaveValue("");
		});
		expect(toast.success).toHaveBeenCalledWith("Thanks! Your report was submitted.");
		expect(toast.error).not.toHaveBeenCalled();
		const body: unknown = JSON.parse(String(fetchMock.mock.calls[0][1].body));
		expect(body).toEqual({ category: "bug", message: MESSAGE, pagePath: "/acme/shop", repoOwner: "acme", repoName: "shop", serviceName: "web" });
	});

	it("keeps the same draft through an unconfirmed response and an explicit successful retry", async () => {
		fetchMock.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({ ok: true, id: REPORT_ID }));
		const onOpenChange = openReport();
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await expectRetainedDraft(onOpenChange);
		fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
		expect(toast.success).toHaveBeenCalledOnce();
	});
});
