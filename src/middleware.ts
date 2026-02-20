import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req : NextRequest) {
	const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

	const isAuthPage = req.nextUrl.pathname.startsWith("/auth")
	const isLanding = req.nextUrl.pathname === "/"
	const isWaitingList = req.nextUrl.pathname === "/waiting-list"
	const isAuthError = req.nextUrl.pathname === "/api/auth/error"
	const isAuthApi = req.nextUrl.pathname.startsWith("/api/auth")

	// Allow unauthenticated access to landing (/), auth, waiting list, and auth API routes
	if (!token && !isAuthPage && !isLanding && !isWaitingList && !isAuthApi) {
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
  matcher: ["/((?!_next|api|static|favicon.ico).*)"], // Exclude static, API, etc.
}