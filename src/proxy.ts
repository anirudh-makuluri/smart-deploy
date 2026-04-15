import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const SESSION_COOKIE_NAMES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
	"better-auth.session_data",
	"__Secure-better-auth.session_data",
	"better-auth.dont_remember",
	"__Secure-better-auth.dont_remember",
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
	const pathname = req.nextUrl.pathname;
	const isAuthPage = pathname.startsWith("/auth");
	const isLanding = pathname === "/";
	const isDocsPage = pathname === "/docs" || pathname.startsWith("/docs/");
	const isChangelogPage = pathname === "/changelog";
	const isWaitingList = pathname === "/waiting-list";
	const isAuthApi = pathname.startsWith("/api/auth");
	const isPosthogProxy = pathname === "/ph" || pathname.startsWith("/ph/");

	// Never run auth checks for PostHog proxy requests.
	if (isPosthogProxy) {
		return NextResponse.next();
	}

	const isPublicPage = isLanding || isDocsPage || isChangelogPage || isWaitingList;
	const shouldCheckSession = isAuthPage || (!isPublicPage && !isAuthApi);

	let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
	if (shouldCheckSession) {
		try {
			session = await auth.api.getSession({ headers: req.headers });
		} catch (err) {
			// DB unreachable (ENOTFOUND, ECONNREFUSED, etc.) should not brick every route.
			console.error("[proxy] auth.api.getSession failed — treating as unauthenticated:", err);
		}
	}
	const email = session?.user?.email;

	// Allow unauthenticated access to public pages and auth API routes.
	if (!session && !isAuthPage && !isLanding && !isDocsPage && !isChangelogPage && !isWaitingList && !isAuthApi) {
		return NextResponse.redirect(new URL("/auth", req.url))
	}

	if (session) {
		const approved = await isApprovedEmail(email);
		if (!approved) {
			const response = NextResponse.redirect(new URL("/waiting-list", req.url));
			clearSessionCookies(response);
			return response;
		}
	}

	if(session && isAuthPage) {
		return NextResponse.redirect(new URL("/home", req.url))
	}

	// Only block non-auth API routes
	if (req.nextUrl.pathname.startsWith("/api") && !isAuthApi && !session) {
		return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
	}

	return NextResponse.next()
}

export const config = {
  matcher: [
		"/((?!_next|api|ph|static|favicon\\.ico|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico)).*)",
  ], // Exclude static assets, API routes, etc.
}
