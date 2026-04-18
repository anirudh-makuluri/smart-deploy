import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabaseServer";

const VALID_CATEGORIES = new Set(["bug", "feature", "general", "other"]);

type ReportPayload = {
	category?: string;
	message?: string;
	pagePath?: string;
	repoOwner?: string;
	repoName?: string;
	serviceName?: string;
};

function trimOrNull(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const user = session?.user;
	if (!user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: ReportPayload;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const category = trimOrNull(body.category) ?? "bug";
	if (!VALID_CATEGORIES.has(category)) {
		return NextResponse.json({ error: "Invalid category" }, { status: 400 });
	}

	const message = trimOrNull(body.message);
	if (!message || message.length < 5) {
		return NextResponse.json({ error: "Message must be at least 5 characters" }, { status: 400 });
	}
	if (message.length > 5000) {
		return NextResponse.json({ error: "Message is too long" }, { status: 400 });
	}

	try {
		const supabase = getSupabaseServer();
		const { data, error } = await supabase
			.from("user_reports")
			.insert({
				user_id: user.id,
				user_email: trimOrNull(user.email),
				user_name: trimOrNull(user.name),
				user_image: trimOrNull(user.image),
				category,
				message,
				page_path: trimOrNull(body.pagePath),
				repo_owner: trimOrNull(body.repoOwner),
				repo_name: trimOrNull(body.repoName),
				service_name: trimOrNull(body.serviceName),
				metadata: {
					user_agent: req.headers.get("user-agent") ?? null,
				},
			})
			.select("id")
			.single();

		if (error) {
			console.error("user report insert error:", error);
			return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, id: data?.id });
	} catch (error) {
		console.error("user report route error:", error);
		return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
	}
}
