import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE_NAMES = [
	"next-auth.session-token",
	"__Secure-next-auth.session-token",
	"authjs.session-token",
	"__Secure-authjs.session-token",
];

async function isApprovedEmail(email: string | null | undefined) {
	const trimmedEmail = (email || "").trim().toLowerCase();
	if (!trimmedEmail) return false;

	const supabaseUrl = process.env.SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !serviceRoleKey) {
		console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for approval checks in proxy");
		return false;
	}

	const url = new URL("/rest/v1/approved_users", supabaseUrl);
	url.searchParams.set("select", "email");
	url.searchParams.set("email", `eq.${trimmedEmail}`);
	url.searchParams.set("limit", "1");

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: {
			apikey: serviceRoleKey,
			Authorization: `Bearer ${serviceRoleKey}`,
		},
		cache: "no-store",
	});

	if (!response.ok) {
		console.error("Proxy approval lookup failed:", response.status);
		return false;
	}

	const rows = (await response.json()) as Array<{ email?: string }>;
	return rows.length > 0;
}

function clearSessionCookies(response: NextResponse) {
	for (const cookieName of SESSION_COOKIE_NAMES) {
		response.cookies.set(cookieName, "", {
			expires: new Date(0),
			path: "/",
		});
	}
}

export async function proxy(req : NextRequest) {
	const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

	const isAuthPage = req.nextUrl.pathname.startsWith("/auth")
	const isLanding = req.nextUrl.pathname === "/"
	const isDocsPage = req.nextUrl.pathname === "/docs" || req.nextUrl.pathname.startsWith("/docs/")
	const isChangelogPage = req.nextUrl.pathname === "/changelog"
	const isWaitingList = req.nextUrl.pathname === "/waiting-list"
	const isAuthApi = req.nextUrl.pathname.startsWith("/api/auth")

	// Allow unauthenticated access to public pages and auth API routes.
	if (!token && !isAuthPage && !isLanding && !isDocsPage && !isChangelogPage && !isWaitingList && !isAuthApi) {
		return NextResponse.redirect(new URL("/auth", req.url))
	}

	if (token) {
		const approved = await isApprovedEmail(typeof token.email === "string" ? token.email : undefined);
		if (!approved) {
			const response = NextResponse.redirect(new URL("/waiting-list", req.url));
			clearSessionCookies(response);
			return response;
		}
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
