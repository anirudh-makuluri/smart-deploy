"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BrowserLoginRequest } from "@/lib/apps/browserLogin";
import type { GatewayAppInspection } from "@/lib/apps/gatewayAuthStore";
import { confirmAppLogin, openAppCallback } from "@/lib/apps/browserCallback";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function AppLoginApproval({ request, app }: { request: BrowserLoginRequest; app: GatewayAppInspection }) {
	const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
	const [status, setStatus] = useState<"ready" | "pending" | "error">("ready");
	const started = useRef(false);
	const active = useRef<AbortController | null>(null);
	useEffect(() => () => { const controller = active.current; active.current = null; controller?.abort(); }, []);

	async function approve(): Promise<void> {
		if (started.current) return;
		started.current = true;
		const controller = new AbortController();
		active.current = controller;
		setStatus("pending");
		const timer = setTimeout(() => controller.abort(), 5000);
		try {
			const callback = await confirmAppLogin(request, app.identity, app.origin, controller.signal);
			if (!controller.signal.aborted) openAppCallback(callback);
		} catch {
			// Unmount/cancel never redirects; an elapsed deadline still needs visible feedback.
			if (active.current === controller) setStatus("error");
		} finally { clearTimeout(timer); }
	}

	function cancel(): void { const controller = active.current; active.current = null; controller?.abort(); }
	return <>
		<div className="space-y-3">
			<p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">App sign-in</p>
			<h1 className="wrap-anywhere text-3xl font-semibold tracking-tight">Open {app.app.name}?</h1>
			<p className="text-sm leading-6 text-muted-foreground">Continue with your verified Smart Deploy account.</p>
		</div>
		<dl className="divide-y divide-border/60 rounded-xl border border-border/60 bg-background/60 px-4 text-sm">
			<Detail label="Account" value={app.identity.email} format="text" />
			<Detail label="Workspace" value={app.workspace.name} format="text" />
			<Detail label="Version" value={app.environment === "published" ? "Published app" : "Unpublished workspace preview"} format="text" />
			<Detail label="Destination" value={app.origin} format="mono" />
		</dl>
		<div className="space-y-3">
			<Button type="button" className="landing-build-blue h-11 w-full" disabled={!hydrated || status !== "ready"} aria-busy={status === "pending"}
				onClick={() => void approve()}>
				{status === "pending" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <ArrowUpRight aria-hidden className="size-4" />}
				{status === "pending" ? "Opening app..." : "Continue to app"}
			</Button>
			{status === "error" ? <p role="alert" className="text-sm leading-6 text-destructive">Sign-in could not be confirmed. Refresh this page to check your account and try again.</p> : null}
			<Link href="/" prefetch={false} onClick={cancel} className="block rounded-md px-3 py-2 text-center text-sm text-muted-foreground outline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">Cancel</Link>
		</div>
	</>;
}

function Detail({ label, value, format }: { label: string; value: string; format: "text" | "mono" }) {
	return <div className="grid gap-1 py-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
		<dt className="text-muted-foreground">{label}</dt>
		<dd className={`min-w-0 wrap-anywhere ${format === "mono" ? "font-mono text-xs leading-5" : "font-medium"}`}>{value}</dd>
	</div>;
}
