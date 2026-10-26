import { z } from "zod";
import { DocumentAddress } from "./documentSchema";

const Address = { collection: DocumentAddress.shape.collection, id: DocumentAddress.shape.id };
const Get = z.strictObject({ action: z.literal("get"), ...Address });
const Put = z.strictObject({
	action: z.literal("put"),
	...Address,
	json: z.string().max(8192),
	expectedVersion: z.uuid().nullable(),
});
const Remove = z.strictObject({ action: z.literal("remove"), ...Address, expectedVersion: z.uuid() });
const Session = { token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) };
export const GatewayDocumentOperation = z.discriminatedUnion("action", [Get, Put, Remove]);
export type GatewayDocumentOperation = z.infer<typeof GatewayDocumentOperation>;
export const GatewayDocumentInput = z.discriminatedUnion("action", [
	Get.extend(Session),
	Put.extend(Session),
	Remove.extend(Session),
]);
