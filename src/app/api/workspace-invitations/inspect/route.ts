import { inspectWorkspaceInvitation } from "@/lib/apps/invitationAcceptanceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	return inspectWorkspaceInvitation(request);
}
