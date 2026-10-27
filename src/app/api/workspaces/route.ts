import { parseWorkspaceBody, withWorkspaceApi, workspaceJson, WorkspaceNameInput } from "@/lib/apps/workspaceApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	return withWorkspaceApi(request, async ({ userId, store }) => workspaceJson({ workspaces: await store.listWorkspaces(userId) }));
}

export async function POST(request: Request) {
	return withWorkspaceApi(request, async ({ userId, store }) => {
		const body = await parseWorkspaceBody(request, WorkspaceNameInput);
		return workspaceJson({ workspace: await store.createWorkspace(userId, body.name) }, 201);
	});
}
