import { NextResponse } from "next/server";

import config from "@/config";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const slug = config.GITHUB_APP_SLUG.trim();
	if (!slug) {
		console.error("GitHub App installation requested without GITHUB_APP_SLUG.");
		return NextResponse.json({ error: "GitHub App installation is not configured" }, { status: 503 });
	}

	return NextResponse.redirect(
		new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`)
	);
}
