"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function CliAuthorizationApproval({ code }: { code: string }) {
	const [status, setStatus] = React.useState<"ready" | "pending" | "approved" | "error">("ready");
	const [message, setMessage] = React.useState("");

	async function approve(): Promise<void> {
		setStatus("pending");
		const response = await fetch("/api/cli/device/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
		if (!response.ok) {
			const payload = await response.json().catch(() => ({})) as { error?: string };
			setMessage(payload.error || "Approval failed.");
			setStatus("error");
			return;
		}
		setStatus("approved");
	}

	if (status === "approved") return <main className="mx-auto flex min-h-svh max-w-xl items-center px-6"><section className="landing-panel landing-shell w-full space-y-4 p-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">CLI connected</p><h1 className="text-3xl font-semibold tracking-tight">You can return to your terminal.</h1><p className="text-sm text-muted-foreground">Smart Deploy CLI is now authorized for your account.</p></section></main>;

	return <main className="mx-auto flex min-h-svh max-w-xl items-center px-6"><section className="landing-panel landing-shell w-full space-y-5 p-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Device approval</p><h1 className="text-3xl font-semibold tracking-tight">Connect Smart Deploy CLI?</h1><p className="text-sm leading-6 text-muted-foreground">The CLI will act as your Smart Deploy account. It will use your existing GitHub connection; GitHub credentials are never sent to the terminal.</p><Button className="landing-build-blue w-full" disabled={status === "pending"} onClick={() => void approve()}>{status === "pending" ? "Approving..." : "Approve CLI"}</Button>{status === "error" ? <p className="text-sm text-destructive">{message}</p> : null}</section></main>;
}
