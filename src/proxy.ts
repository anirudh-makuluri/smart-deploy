import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(req : NextRequest) {
	const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

	const isAuthPage = req.nextUrl.pathname.startsWith("/auth")
	const isLanding = req.nextUrl.pathname === "/"
	const isDocsPage = req.nextUrl.pathname === "/docs"
	const isChangelogPage = req.nextUrl.pathname === "/changelog"
	const isWaitingList = req.nextUrl.pathname === "/waiting-list"
	const isAuthApi = req.nextUrl.pathname.startsWith("/api/auth")

	// Allow unauthenticated access to public pages and auth API routes.
	if (!token && !isAuthPage && !isLanding && !isDocsPage && !isChangelogPage && !isWaitingList && !isAuthApi) {
		return NextResponse.redirect(new URL("/auth", req.url))
	}

	if(token && isAuthPage) {
		return NextResponse.redirect(new URL("/home", req.url))
	}

	// Only block non-auth API routes
	if (req.nextUrl.pathname.startsWith("/api") && !isAuthApi && !token) {
		return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
	}

	return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next|api|static|favicon\\.ico|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico)).*)",
  ], // Exclude static assets, API routes, etc.
}
