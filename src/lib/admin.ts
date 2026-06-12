import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

function adminEmailSet(): Set<string> {
	return new Set(
		(process.env.ADMIN_EMAILS ?? "")
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter(Boolean)
	);
}

export function isAdminEmail(email: string | null | undefined): boolean {
	const normalized = (email ?? "").trim().toLowerCase();
	if (!normalized) return false;
	return adminEmailSet().has(normalized);
}

export async function requireAdminSession() {
	const session = await auth.api.getSession({ headers: await headers() });
	const user = session?.user;
	if (!user?.id) {
		redirect("/auth");
	}
	if (!isAdminEmail(user.email)) {
		redirect("/home");
	}
	return user;
}
