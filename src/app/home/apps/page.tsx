import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import Header from "@/components/Header";
import { WorkspaceManagement } from "@/components/apps/WorkspaceManagement";
import { auth } from "@/lib/auth";
import { requirePlatformAccess } from "@/lib/platformAccess";
import config from "@/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Apps & team", robots: { index: false, follow: false }, referrer: "no-referrer" };
async function content() {
	if (!config.WORKSPACE_APPS_ENABLED || !config.PRIVATE_APP_GATEWAY_ENABLED) return <p className="text-sm text-muted-foreground">Team applications aren&apos;t available right now.</p>;
	try {
		const principal = await auth.api.getSession({ headers: await headers(), query: { disableCookieCache: true, disableRefresh: true } });
		if (!principal) return <p role="alert">Sign in to manage your apps.</p>;
		await requirePlatformAccess(principal.user); return <WorkspaceManagement principal={{ id: principal.user.id, email: principal.user.email }} publishEnabled={config.PRIVATE_APP_PUBLISH_ENABLED === true} />;
	} catch { return <p role="alert" className="text-sm text-muted-foreground">App management is unavailable. Use a verified, approved account and try again.</p>; }
}
export default async function WorkspaceManagementPage() {
	return <div className="landing-bg min-h-svh text-foreground"><Header /><main className="mx-auto max-w-6xl space-y-8 px-5 py-8 sm:px-8"><div className="space-y-3"><Link href="/home" prefetch={false} className="text-sm text-muted-foreground underline underline-offset-4">Back to dashboard</Link><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Apps & team</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A workspace for your small software.</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">Keep apps and colleagues together. Invite people to your team, then choose which published apps they can use.</p></div>{await content()}</main></div>;
}
