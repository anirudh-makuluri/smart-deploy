import { InvitationInput, parseWorkspaceBody, withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ workspaceId: string }> }

export async function GET(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const { workspaceId } = await context.params;
		return workspaceJson({ invitations: await store.listInvitations(workspaceId, userId) });
	});
}

export async function POST(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const [{ workspaceId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, InvitationInput)]);
		return workspaceJson({ invitation: await store.createInvitation(workspaceId, userId, body.email, body.role) }, 201);
	});
}
