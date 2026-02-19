import { NextRequest, NextResponse } from 'next/server';
import config from '@/config';

export async function GET(req: NextRequest) {
	// Redirect to waiting list page when access is denied
	// Get the proper origin from headers or use NEXTAUTH_URL
	const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
	const protocol = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol === 'https:' ? 'https' : 'http');
	
	// Use NEXTAUTH_URL if available, otherwise construct from headers
	let baseUrl: string;
	if (config.NEXTAUTH_URL && config.NEXTAUTH_URL !== 'http://localhost:3000') {
		baseUrl = config.NEXTAUTH_URL;
	} else if (host) {
		baseUrl = `${protocol}://${host}`;
	} else {
		// Fallback to nextUrl if nothing else works
		baseUrl = req.nextUrl.origin;
	}
	
	const redirectUrl = new URL('/waiting-list', baseUrl);
	return NextResponse.redirect(redirectUrl);
}
