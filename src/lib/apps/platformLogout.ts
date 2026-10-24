import type { Pool } from "pg";
import { NextResponse } from "next/server";
import { withWorkspaceTransaction } from "./workspaceStore";

export interface PlatformLogoutSession { session: { id: string }; user: { id: string } }
export interface PlatformLogoutDependencies {
	post: (request: Request) => Promise<Response>;
	loadSession: () => Promise<PlatformLogoutSession | null>;
	getPool: () => Pool;
}

/** Better Auth 1.6.23 can swallow a session-delete error. Complete revocation
 * transactionally before asking it to clear the browser cookie. */
export async function verifiedPlatformLogout(request: Request, dependencies: PlatformLogoutDependencies): Promise<Response> {
	try {
		if (request.method !== "POST" || request.headers.get("origin") !== new URL(request.url).origin) {
			return NextResponse.json({ error: "A same-origin logout request is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
		}
		const principal = await dependencies.loadSession();
		if (!principal) return await dependencies.post(request);
		const pool = dependencies.getPool();
		const ready = await pool.query<{ ready: boolean }>(`
			select exists (select 1 from pg_trigger where tgrelid = to_regclass('public.session')
			and tgname = 'app_gateway_platform_logout' and tgenabled in ('O', 'A') and not tgisinternal
			and tgfoid = to_regprocedure('public.invalidate_gateway_on_platform_logout()')) as ready
		`);
		if (!ready.rows[0]?.ready) throw new Error("Logout migration unavailable.");
		await withWorkspaceTransaction(pool, async (client) => {
			// Keep session -> user lock order consistent with handoff/redemption.
			await client.query('select id from public.session where id = $1 and "userId" = $2 for update', [principal.session.id, principal.user.id]);
			await client.query('select id from public."user" where id = $1 for update', [principal.user.id]);
			await client.query("delete from public.app_gateway_codes where user_id = $1", [principal.user.id]);
			await client.query("delete from public.app_gateway_sessions where user_id = $1", [principal.user.id]);
			await client.query('delete from public.session where id = $1 and "userId" = $2', [principal.session.id, principal.user.id]);
		});
		// Signature/cookie handling stays with Better Auth. Its DB row is already
		// removed, so a swallowed deletion error cannot leave private access alive.
		return await dependencies.post(request);
	} catch {
		console.error("Platform logout could not verify app-session revocation.");
		return NextResponse.json({ error: "Sign-out could not be completed. Please retry." }, {
			status: 503, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
		});
	}
}
