import { MemberInput, MemberRoleInput, parseWorkspaceBody, withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ workspaceId: string }> }

export async function GET(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const { workspaceId } = await context.params;
		return workspaceJson({ members: await store.listMembers(workspaceId, userId) });
	});
}

export async function DELETE(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const [{ workspaceId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, MemberInput)]);
		await store.removeMember(workspaceId, userId, body.userId);
		return workspaceJson({ ok: true });
	});
}

export async function PATCH(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const [{ workspaceId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, MemberRoleInput)]);
		await store.setMemberRole(workspaceId, userId, body.userId, body.role);
		return workspaceJson({ ok: true });
	});
}
