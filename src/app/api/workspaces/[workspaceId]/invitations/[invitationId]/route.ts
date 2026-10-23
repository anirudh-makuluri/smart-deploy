import { withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ workspaceId: string; invitationId: string }> }

export async function DELETE(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const { workspaceId, invitationId } = await context.params;
		await store.revokeInvitation(workspaceId, userId, invitationId);
		return workspaceJson({ ok: true });
	});
}
