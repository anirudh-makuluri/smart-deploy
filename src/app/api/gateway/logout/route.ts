import { GatewaySessionInput, gatewayJson, parseGatewayBody, withGatewayApi } from "@/lib/apps/gatewayApi";

export async function POST(request: Request) {
	return withGatewayApi(request, async ({ bindingId, store }) => {
		const { token } = await parseGatewayBody(request, GatewaySessionInput);
		await store.revoke(bindingId, token);
		return gatewayJson({ revoked: true });
	});
}
