import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
	// Redirect to waiting list page when access is denied
	return NextResponse.redirect(new URL('/waiting-list', req.url));
}
