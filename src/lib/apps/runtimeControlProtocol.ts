import { z } from "zod";

export const RuntimeControlRequest = z.discriminatedUnion("action", [
	z.strictObject({ action: z.literal("inspect"), requestId: z.uuid(), appId: z.uuid() }),
	z.strictObject({ action: z.literal("activate"), requestId: z.uuid(), appId: z.uuid(), environment: z.enum(["preview", "published"]), releaseId: z.uuid(), expectedCurrentId: z.uuid().nullable() }),
]);
export type RuntimeControlRequest = z.infer<typeof RuntimeControlRequest>;
const PublicOrigin = z.string().max(255).refine(value => { try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; } catch { return false; } });
const Selection = z.strictObject({ environment: z.enum(["preview", "published"]), runtimeId: z.uuid(), releaseId: z.uuid(), generation: z.number().int().positive(), origin: PublicOrigin, available: z.boolean() });
const Choice = z.strictObject({ environment: z.enum(["preview", "published"]), releaseId: z.uuid(), label: z.string().min(1).max(80), available: z.boolean() });
export const RuntimeControlView = z.strictObject({ expiresAt: z.number().int().positive(), choices: z.array(Choice).max(3), selected: z.array(Selection).max(2) });
export type RuntimeControlView = z.infer<typeof RuntimeControlView>;
export const RuntimeControlReply = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), requestId: z.uuid(), appId: z.uuid(), view: RuntimeControlView }),
	z.strictObject({ ok: z.literal(false), requestId: z.uuid().nullable(), status: z.number().int().min(400).max(599), error: z.string().max(200) }),
]);
export type RuntimeControlReply = z.infer<typeof RuntimeControlReply>;
