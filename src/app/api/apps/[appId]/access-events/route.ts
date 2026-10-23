import { withWorkspaceApi, workspaceJson } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ appId: string }> }

export async function GET(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const { appId } = await context.params;
		return workspaceJson({ events: await apps.listAccessEvents(appId, userId) });
	});
}
