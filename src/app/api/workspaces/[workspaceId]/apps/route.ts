import { parseWorkspaceBody, withWorkspaceApi, workspaceJson, WorkspaceNameInput } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
interface RouteContext { params: Promise<{ workspaceId: string }> }

export async function GET(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const { workspaceId } = await context.params;
		return workspaceJson({ apps: await apps.listApps(workspaceId, userId) });
	});
}

export async function POST(request: Request, context: RouteContext) {
	return withWorkspaceApi(request, async ({ userId, apps }) => {
		const [{ workspaceId }, body] = await Promise.all([context.params, parseWorkspaceBody(request, WorkspaceNameInput)]);
		return workspaceJson({ app: await apps.createApp(workspaceId, userId, body.name) }, 201);
	});
}
