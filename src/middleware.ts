import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req : NextRequest) {
	const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

	const isAuthPage = req.nextUrl.pathname.startsWith("/auth")

	if(!token && !isAuthPage) {
		return NextResponse.redirect(new URL("/auth", req.url))
	}

	if(token && isAuthPage) {
		return NextResponse.redirect(new URL("/", req.url))
	}

	if (req.nextUrl.pathname.startsWith("/api") && !token) {
		return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
	}

	return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next|api|static|favicon.ico).*)"], // Exclude static, API, etc.
}