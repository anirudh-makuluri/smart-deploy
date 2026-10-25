import { z } from "zod";

const Secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const BrowserLoginInput = z.strictObject({ bindingId: z.uuid(), challenge: Secret, state: Secret });
export const BrowserLoginIdentity = z.strictObject({
	id: z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),
	email: z.string().min(1).max(254).regex(/^[^\u0000-\u001f\u007f]+$/),
});
export const BrowserHandoffInput = z.strictObject({ ...BrowserLoginInput.shape, expectedIdentity: BrowserLoginIdentity });
export type BrowserLoginRequest = z.infer<typeof BrowserLoginInput>;

export function browserLoginPath(input: BrowserLoginRequest): string {
	return "/apps/authorize?" + new URLSearchParams(BrowserLoginInput.parse(input)).toString();
}
