import { InvitationAcceptanceInput, parseWorkspaceBody, withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const body = await parseWorkspaceBody(request, InvitationAcceptanceInput);
		const accepted = await store.acceptInvitation(userId, body.token);
		return workspaceJson(accepted);
	});
}
