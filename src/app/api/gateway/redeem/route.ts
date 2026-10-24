import { GatewayRedemptionInput, gatewayJson, parseGatewayBody, requireGatewayIdentity, withGatewayApi } from "@/lib/apps/gatewayApi";

export async function POST(request: Request) {
	return withGatewayApi(request, async ({ bindingId, store }) => {
		const input = await parseGatewayBody(request, GatewayRedemptionInput);
		const session = await store.redeem(bindingId, input.callbackUrl, input.code, input.verifier);
		try {
			const identity = await requireGatewayIdentity(store, bindingId, session.token);
			return gatewayJson({ ...session, identity });
		} catch (error) {
			await store.revoke(bindingId, session.token);
			throw error;
		}
	});
}
