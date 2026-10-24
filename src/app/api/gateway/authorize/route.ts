import { GatewaySessionInput, gatewayJson, parseGatewayBody, requireGatewayIdentity, withGatewayApi } from "@/lib/apps/gatewayApi";

export async function POST(request: Request) {
	return withGatewayApi(request, async ({ bindingId, store }) => {
		const { token } = await parseGatewayBody(request, GatewaySessionInput);
		return gatewayJson({ identity: await requireGatewayIdentity(store, bindingId, token) });
	});
}
