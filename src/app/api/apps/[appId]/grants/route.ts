import { MemberInput, parseWorkspaceBody, withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ appId: string }> }

export async function GET(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const { appId } = await context.params;
		return workspaceJson({ grants: await apps.listGrants(appId, userId) });
	});
}

export async function POST(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const [{ appId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, MemberInput)]);
		await apps.grantUse(appId, userId, body.userId);
		return workspaceJson({ ok: true });
	});
}

export async function DELETE(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const [{ appId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, MemberInput)]);
		await apps.revokeUse(appId, userId, body.userId);
		return workspaceJson({ ok: true });
	});
}
