import config from "@/config";
import { AppDataError } from "@/lib/apps/documentSchema";
import { GatewayDocumentInput } from "@/lib/apps/documentApiSchema";
import {
	gatewayJson,
	parseGatewayBody,
	requirePrivateAppAdmission,
	withGatewayApi,
} from "@/lib/apps/gatewayApi";
import { executePilotDocument } from "@/lib/apps/pilotDocumentBackend";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

export const runtime = "nodejs";
export async function POST(request: Request) {
	if (!config.PRIVATE_APP_DOCUMENTS_ENABLED || request.signal.aborted)
		return gatewayJson({ error: "App data operation unavailable." }, 503);
	const controller = new AbortController();
	let expire: () => void = () => {};
	const deadline = new Promise<Response>((resolve) => {
		expire = () => {
			controller.abort();
			resolve(gatewayJson({ error: "App data operation unavailable." }, 503));
		};
	});
	const timer = setTimeout(expire, 4000);
	request.signal.addEventListener("abort", expire, { once: true });
	if (request.signal.aborted) expire();
	try {
		const work = withGatewayApi(request, async ({ bindingId, store }) => {
			if (controller.signal.aborted) throw new WorkspaceError(503, "App data operation unavailable.");
			const { token, ...operation } = await parseGatewayBody(
				request,
				GatewayDocumentInput,
				32768,
				controller.signal,
			);
			if (controller.signal.aborted) throw new WorkspaceError(503, "App data operation unavailable.");
			const authorization = await store.authorizeDocuments(bindingId, token);
			if (!authorization) throw new WorkspaceError(403, "App access unavailable.");
			await requirePrivateAppAdmission(store, bindingId, authorization.identity);
			try {
				return gatewayJson(await executePilotDocument(authorization.scope, operation, controller.signal));
			} catch (error) {
				if (error instanceof AppDataError) return gatewayJson({ error: error.message }, error.status);
				throw error;
			}
		});
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
		request.signal.removeEventListener("abort", expire);
		controller.abort();
	}
}
