import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { LoginForm } from "@/components/login-form";
import { AppLoginApproval } from "@/components/apps/AppLoginApproval";
import { loadAppLoginConfirmation } from "@/lib/apps/loginConfirmation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "App sign-in", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AppAuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const confirmation = await loadAppLoginConfirmation(await searchParams, new Headers(await headers()));
	return <main className="landing-bg flex min-h-svh items-center justify-center px-5 py-10 text-foreground">
		<section className="landing-panel landing-shell w-full max-w-lg space-y-7 p-6 sm:p-8" aria-label="App sign-in confirmation">
			<SmartDeployLogo showText size="md" />
			{confirmation.status === "ready" ? <AppLoginApproval key={`${confirmation.request.bindingId}:${confirmation.request.state}:${confirmation.request.challenge}:${confirmation.app.identity.id}:${confirmation.app.identity.email}:${confirmation.app.origin}:${confirmation.app.environment}`}
				request={confirmation.request} app={confirmation.app} /> : confirmation.status === "signin" ? <>
				<div className="space-y-3"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">App sign-in</p>
					<h1 className="text-3xl font-semibold tracking-tight">Sign in to open your app.</h1>
					<p className="text-sm leading-6 text-muted-foreground">Use the account your workspace invited. You can review the app before continuing.</p></div>
				<LoginForm callbackURL={confirmation.callbackURL} />
			</> : <Unavailable status={confirmation.status} />}
		</section>
	</main>;
}

function Unavailable({ status }: { status: "disabled" | "invalid" | "denied" | "unavailable" }) {
	const message = status === "denied" ? "We couldn't confirm access with this account. Ask your workspace owner for access, then start again from the app link."
		: status === "invalid" ? "This sign-in link is incomplete. Open the app again to start a fresh sign-in."
			: "App sign-in is temporarily unavailable. Please start again from the app link later.";
	return <><h1 className="text-3xl font-semibold tracking-tight">App sign-in unavailable</h1>
		<p className="text-sm leading-6 text-muted-foreground">{message}</p>
		<Link href="/" prefetch={false} className="inline-block rounded-md text-sm text-primary outline-offset-4 focus-visible:outline-2 focus-visible:outline-primary">Back to Smart Deploy</Link></>;
}
