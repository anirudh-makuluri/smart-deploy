import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import appConfig from "@/config";
import { dbHelper } from "@/db-helper";

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
	const accept = req.headers?.get?.("accept") ?? "";
	const wantsMarkdown = accept.includes("text/markdown");

	if (pathname === "/docs.md") {
		const markdownTarget = req.nextUrl.clone();
		markdownTarget.pathname = "/api/docs-markdown";
		markdownTarget.searchParams.set("slug", "__readme__");
		return NextResponse.rewrite(markdownTarget);
	}
	if (pathname === "/changelog.md") {
		const markdownTarget = req.nextUrl.clone();
		markdownTarget.pathname = "/api/docs-markdown";
		markdownTarget.searchParams.set("slug", "__changelog__");
		return NextResponse.rewrite(markdownTarget);
	}
	const docsMarkdownPath = /^\/docs\/([^/]+)\.md$/i.exec(pathname);
	if (docsMarkdownPath?.[1]) {
		const markdownTarget = req.nextUrl.clone();
		markdownTarget.pathname = "/api/docs-markdown";
		markdownTarget.searchParams.set("slug", docsMarkdownPath[1].toLowerCase());
		return NextResponse.rewrite(markdownTarget);
	}

	if (wantsMarkdown) {
		const markdownTarget = req.nextUrl.clone();
		if (pathname === "/docs") {
			markdownTarget.pathname = "/api/docs-markdown";
			markdownTarget.searchParams.set("slug", "__readme__");
			return NextResponse.rewrite(markdownTarget);
		}
		if (pathname.startsWith("/docs/")) {
			const slug = pathname.replace(/^\/docs\//, "");
			if (slug && !slug.includes("/")) {
				markdownTarget.pathname = "/api/docs-markdown";
				markdownTarget.searchParams.set("slug", slug);
				return NextResponse.rewrite(markdownTarget);
			}
		}
		if (pathname === "/changelog") {
			markdownTarget.pathname = "/api/docs-markdown";
			markdownTarget.searchParams.set("slug", "__changelog__");
			return NextResponse.rewrite(markdownTarget);
		}
	}

	const isRobotsTxt = pathname === "/robots.txt";
	const isSitemapXml = pathname === "/sitemap.xml";
	const isAuthPage = pathname.startsWith("/auth");
	const isLanding = pathname === "/";
	const isDocsPage = pathname === "/docs" || pathname.startsWith("/docs/");
	const isChangelogPage = pathname === "/changelog";
	const isWaitingList = pathname === "/waiting-list";
	const isMcp = pathname === "/mcp";
	const isSkillMd = pathname === "/skill.md";
	const isWellKnown = pathname === "/.well-known" || pathname.startsWith("/.well-known/");
	const isAuthApi = pathname.startsWith("/api/auth");
	const isPosthogProxy = pathname === "/ph" || pathname.startsWith("/ph/");
	const isPrivateHome = pathname === "/home" || pathname.startsWith("/home/");

	// Never run auth checks for PostHog proxy requests.
	if (isPosthogProxy) {
		return NextResponse.next();
	}

	const isPublicPage =
		isLanding ||
		isDocsPage ||
		isChangelogPage ||
		isWaitingList ||
		isRobotsTxt ||
		isSitemapXml ||
		isMcp ||
		isSkillMd ||
		isWellKnown;
	const shouldCheckSession = isAuthPage || isPrivateHome;

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

	// Only redirect known private app routes.
	if (!session && isPrivateHome && !isAuthApi) {
		return NextResponse.redirect(new URL("/auth", req.url));
	}

	if (session) {
		if (appConfig.WAITING_LIST_ENABLED) {
			const approved = await isApprovedEmail(email);
			if (!approved) {
				if (email) {
					await dbHelper.addToWaitingList(email, session.user?.name ?? null);
				}
				const response = NextResponse.redirect(new URL("/waiting-list", req.url));
				clearSessionCookies(response);
				return response;
			}
		}
	}

	if (session && isAuthPage) {
		return NextResponse.redirect(new URL("/home", req.url));
	}

	if (!isPublicPage && !isPrivateHome && !isAuthPage && !isAuthApi) {
		// Let unknown routes resolve naturally (404), not auth redirects (soft-404 behavior).
		return NextResponse.next();
	}

	return NextResponse.next();
}

export const config = {
  matcher: [
		"/((?!_next|api|ph|static|favicon\\.ico|.*\\.(?:png|svg|jpg|jpeg|webp|gif|ico|txt|xml|json)).*)",
  ], // Exclude static assets, API routes, etc.
}
