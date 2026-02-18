import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";

// Force dynamic rendering - prevents Next.js from analyzing this route during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
	try {
		const timestamp = new Date().toISOString();
		
		// Optional: Check database connectivity
		let dbStatus = 'unknown';
		try {
			// Simple database connectivity check
			await db.collection('_health').limit(1).get();
			dbStatus = 'connected';
		} catch (error) {
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
