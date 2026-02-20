import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

// Force dynamic rendering - prevents Next.js from analyzing this route during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
	try {
		const timestamp = new Date().toISOString();

		let dbStatus = 'unknown';
		try {
			const supabase = getSupabaseServer();
			await supabase.from("_health").select("id").limit(1).maybeSingle();
			dbStatus = 'connected';
		} catch {
			dbStatus = 'disconnected';
		}

		return NextResponse.json({
			status: 'healthy',
			timestamp,
			service: 'smart-deploy',
			database: dbStatus,
		}, { status: 200 });

	} catch (error) {
		console.error("Health check error:", error);
		return NextResponse.json({
			status: 'unhealthy',
			timestamp: new Date().toISOString(),
			error: error instanceof Error ? error.message : 'Unknown error'
		}, { status: 503 });
	}
}
