import { createClient, SupabaseClient } from "@supabase/supabase-js";
import config from "../config";

let _client: SupabaseClient | null = null;

/**
 * Server-only Supabase client with service role key.
 * Use for all server-side DB access (API routes, server actions).
 */
export function getSupabaseServer(): SupabaseClient {
	if (_client) return _client;
	const url = config.SUPABASE_URL;
	const key = config.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error(
			"SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment"
		);
	}
	_client = createClient(url, key, {
		auth: { persistSession: false },
	});
	return _client;
}
