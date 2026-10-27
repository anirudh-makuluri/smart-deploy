import { z } from "zod";
import config from "@/config";
import { gatewayJson, parseGatewayBody, withGatewayApi } from "@/lib/apps/gatewayApi";
import { inspectPilotDocumentBackend } from "@/lib/apps/pilotDocumentBackend";
import { WorkspaceError } from "@/lib/apps/workspaceStore";

export const runtime = "nodejs";
const Empty = z.strictObject({});
/** Selected machine gateway only. Public reply is a boolean; no user session/data or AWS metadata. */
export async function POST(request: Request) {
  if (!config.PRIVATE_APP_DOCUMENTS_ENABLED || request.signal.aborted) return gatewayJson({ error: "App data readiness unavailable." }, 503);
  const controller = new AbortController(); let expire = () => {};
  const deadline = new Promise<Response>(resolve => { expire = () => { controller.abort(); resolve(gatewayJson({ error: "App data readiness unavailable." }, 503)); }; });
  const timer = setTimeout(expire, 4000); request.signal.addEventListener("abort", expire, { once: true }); if (request.signal.aborted) expire();
  try {
    const work = withGatewayApi(request, async ({ bindingId, store }) => {
      await parseGatewayBody(request, Empty, 64, controller.signal);
      if (controller.signal.aborted) throw new WorkspaceError(503, "App data readiness unavailable.");
      const scope = await store.documentReadinessScope(bindingId);
      if (controller.signal.aborted) throw new WorkspaceError(503, "App data readiness unavailable.");
      await inspectPilotDocumentBackend(scope, controller.signal);
      if (controller.signal.aborted) throw new WorkspaceError(503, "App data readiness unavailable.");
      return gatewayJson({ ready: true });
    });
    return await Promise.race([work, deadline]);
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", expire); controller.abort(); }
}
