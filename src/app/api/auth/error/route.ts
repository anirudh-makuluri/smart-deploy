import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
	// Redirect to waiting list page when access is denied
	// Use nextUrl to properly construct the URL with the correct origin
	const url = req.nextUrl.clone();
	url.pathname = '/waiting-list';
	url.search = ''; // Clear any query parameters
	return NextResponse.redirect(url);
}
