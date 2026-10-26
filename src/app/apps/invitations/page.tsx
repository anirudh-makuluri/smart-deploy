import type { Metadata } from "next";
import { SmartDeployLogo } from "@/components/SmartDeployLogo";
import { WorkspaceInvitation } from "@/components/apps/WorkspaceInvitation";
import config from "@/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Workspace invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function WorkspaceInvitationPage() {
	return <main className="landing-bg flex min-h-svh items-center justify-center px-5 py-10 text-foreground"><section className="landing-panel landing-shell ph-no-capture ph-mask w-full max-w-lg space-y-7 p-6 sm:p-8" aria-label="Workspace invitation">
		<SmartDeployLogo showText size="md" /><div className="space-y-3"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">An invitation to collaborate</p><h1 className="text-3xl font-semibold tracking-tight">Your workspace is waiting.</h1></div>
		{config.WORKSPACE_APPS_ENABLED && config.PRIVATE_APP_GATEWAY_ENABLED ? <WorkspaceInvitation /> : <p role="status" className="text-sm text-muted-foreground">Workspace invitations are temporarily unavailable.</p>}
	</section></main>;
}
